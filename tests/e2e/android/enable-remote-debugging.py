#!/usr/bin/env python3
"""Enable and verify Fenix's secret Remote debugging via USB setting through its own UI."""

import os
import json
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET


ADB = os.environ.get("ADB_BIN", "adb")
PACKAGE = os.environ.get("FENIX_PACKAGE", "org.mozilla.firefox")
TIMEOUT_SECONDS = 90
POLL_SECONDS = 0.5


def adb(*args):
    return subprocess.run(
        [ADB, *args],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def dump_nodes():
    adb("shell", "uiautomator", "dump", "/sdcard/yta-ui.xml")
    root = ET.fromstring(adb("exec-out", "cat", "/sdcard/yta-ui.xml"))
    return list(root.iter("node"))


def text_of(node):
    return (node.attrib.get("text", ""), node.attrib.get("content-desc", ""))


def matching_nodes(nodes, labels):
    return [
        node
        for node in nodes
        if any(value == label for label in labels for value in text_of(node))
    ]


def select_control(nodes, labels):
    interactive = [
        node
        for node in nodes
        if node.attrib.get("clickable") == "true" or node.attrib.get("checkable") == "true"
    ]
    if len(interactive) == 1:
        return interactive[0]
    if len(nodes) == 1:
        return nodes[0]
    raise RuntimeError(f"expected exactly one of {labels}, found {[node.attrib for node in nodes]}")


def dismiss_pixel_launcher_anr(nodes):
    if len(matching_nodes(nodes, ("Pixel Launcher isn't responding",))) != 1:
        return False
    wait = matching_nodes(nodes, ("Wait",))
    if len(wait) != 1:
        raise RuntimeError(f"Pixel Launcher ANR has no unique Wait control: {[node.attrib for node in wait]}")
    tap(wait[0])
    return True


def bounds_center(node):
    match = re.fullmatch(
        r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]",
        node.attrib.get("bounds", ""),
    )
    if not match:
        raise RuntimeError(f"UI node has no tappable bounds: {node.attrib}")
    left, top, right, bottom = map(int, match.groups())
    if right <= left or bottom <= top:
        raise RuntimeError(f"UI node has empty bounds: {node.attrib}")
    return ((left + right) // 2, (top + bottom) // 2)


def bounds_box(node):
    match = re.fullmatch(
        r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]",
        node.attrib.get("bounds", ""),
    )
    if not match:
        raise RuntimeError(f"UI node has no bounds: {node.attrib}")
    return tuple(map(int, match.groups()))


def tap(node):
    x, y = bounds_center(node)
    adb("shell", "input", "tap", str(x), str(y))


def wait_for(labels, timeout=TIMEOUT_SECONDS):
    deadline = time.monotonic() + timeout
    last = []
    while time.monotonic() < deadline:
        nodes = dump_nodes()
        if dismiss_pixel_launcher_anr(nodes):
            time.sleep(POLL_SECONDS)
            continue
        found = matching_nodes(nodes, labels)
        try:
            return select_control(found, labels)
        except RuntimeError:
            pass
        last = [node.attrib for node in found]
        time.sleep(POLL_SECONDS)
    raise RuntimeError(f"expected exactly one of {labels}, found {last}")


def dismiss_onboarding():
    for _ in range(6):
        nodes = dump_nodes()
        found = matching_nodes(
            nodes,
            (
                "Get started",
                "Continue",
                "Next",
                "Not now",
                "Skip",
                "Start browsing",
            ),
        )
        clickable = [node for node in found if node.attrib.get("clickable") == "true"]
        if len(clickable) != 1:
            return
        tap(clickable[0])
        time.sleep(POLL_SECONDS)


def scroll_down():
    nodes = dump_nodes()
    bounds = []
    for node in nodes:
        if not node.attrib.get("bounds"):
            continue
        left, top, right, bottom = bounds_box(node)
        if right > left and bottom > top:
            bounds.append((left, top, right, bottom))
    if not bounds:
        raise RuntimeError("cannot determine Fenix viewport bounds")
    width = max(right for _, _, right, _ in bounds)
    height = max(bottom for _, _, _, bottom in bounds)
    adb(
        "shell",
        "input",
        "swipe",
        str(width // 2),
        str((height * 3) // 4),
        str(width // 2),
        str(height // 4),
        "300",
    )


def remote_debugging_nodes():
    for _ in range(12):
        nodes = dump_nodes()
        found = matching_nodes(nodes, ("Remote debugging via USB",))
        try:
            label = select_control(found, ("Remote debugging via USB",))
        except RuntimeError:
            label = None
        if label is not None:
            if "checked" in label.attrib:
                return label, label
            _, label_top, _, label_bottom = bounds_box(label)
            controls = [
                node
                for node in nodes
                if node.attrib.get("checkable") == "true"
                and bounds_box(node)[1] <= label_bottom
                and bounds_box(node)[3] >= label_top
            ]
            if len(controls) == 1:
                return label, controls[0]
            raise RuntimeError(
                f"expected one Remote debugging via USB switch, found {[node.attrib for node in controls]}"
            )
        scroll_down()
        time.sleep(POLL_SECONDS)
    raise RuntimeError("Remote debugging via USB control was not found")


def scroll_to_label(label):
    labels = (label,) if isinstance(label, str) else label
    for _ in range(12):
        found = matching_nodes(dump_nodes(), labels)
        try:
            return select_control(found, labels)
        except RuntimeError:
            pass
        scroll_down()
        time.sleep(POLL_SECONDS)
    raise RuntimeError(f"{labels} control was not found")


def firefox_wordmark():
    deadline = time.monotonic() + TIMEOUT_SECONDS
    last = []
    while time.monotonic() < deadline:
        nodes = dump_nodes()
        candidates = [
            node
            for node in nodes
            if node.attrib.get("resource-id", "").endswith("/wordmark")
            and node.attrib.get("class", "").endswith("ImageView")
        ]
        if len(candidates) == 1:
            return candidates[0]
        last = [node.attrib for node in candidates]
        time.sleep(POLL_SECONDS)
    raise RuntimeError(f"expected one Firefox wordmark, found {last}")


def main():
    if not re.fullmatch(r"org\.mozilla\.(?:fenix|firefox)", PACKAGE):
        raise RuntimeError(f"unexpected Fenix package: {PACKAGE}")
    if not adb("shell", "pidof", PACKAGE).strip():
        raise RuntimeError(f"Fenix did not start: {PACKAGE}")

    dismiss_onboarding()
    tap(wait_for(("More options", "Menu")))
    tap(wait_for(("Settings",)))
    tap(scroll_to_label("About Firefox"))
    logo = firefox_wordmark()
    for _ in range(5):
        tap(logo)
        time.sleep(POLL_SECONDS)
    adb("shell", "input", "keyevent", "BACK")
    remote_label, remote_switch = remote_debugging_nodes()
    if remote_switch.attrib.get("checked") != "true":
        tap(remote_label)
    deadline = time.monotonic() + TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        remote_label, remote_switch = remote_debugging_nodes()
        if remote_switch.attrib.get("checked") == "true":
            scroll_to_label(("Secret settings", "Secret Settings"))
            print("Fenix Remote debugging via USB enabled")
            return
        time.sleep(POLL_SECONDS)
    raise RuntimeError("Remote debugging via USB did not become checked")


def ui_diagnostics():
    try:
        fields = (
            "text",
            "content-desc",
            "resource-id",
            "class",
            "clickable",
            "checkable",
            "checked",
            "bounds",
        )
        return [
            {field: node.attrib.get(field, "") for field in fields}
            for node in dump_nodes()
            if node.attrib.get("text") or node.attrib.get("content-desc")
        ]
    except Exception as error:
        return [{"diagnostic_error": str(error)}]


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Remote debugging setup failed: {error}", file=sys.stderr)
        print(json.dumps(ui_diagnostics()), file=sys.stderr)
        raise
