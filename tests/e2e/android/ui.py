#!/usr/bin/env python3
"""Headless Fenix UI driver via uiautomator.

Usage:
  ui.py list
  ui.py find <text>
  ui.py tap <text>
  ui.py scroll [up|down]
  ui.py enable-remote-debugging
"""
import json
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET


ADB = os.environ.get("ADB", "adb")
UI_DUMP_PATH = "/sdcard/yta-ui.xml"
UI_READY_TIMEOUT = 90
UI_DUMP_ATTEMPT_TIMEOUT = 10
UI_DUMP_INITIAL_DELAY = 0.25
UI_DUMP_MAX_DELAY = 2
UI_DUMP_FAILURES_TO_REPORT = 5
ADB_COMMAND_TIMEOUT = 15
SETTINGS_ROUTE_ATTEMPTS = 3
SETTINGS_MENU_TIMEOUT = 45
SETTINGS_ITEM_TIMEOUT = 30


def adb(*args, timeout=ADB_COMMAND_TIMEOUT):
    command = [ADB, *args]
    try:
        return subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        stdout = error.stdout.decode() if isinstance(error.stdout, bytes) else error.stdout or ""
        stderr = error.stderr.decode() if isinstance(error.stderr, bytes) else error.stderr or ""
        return subprocess.CompletedProcess(
            command,
            124,
            stdout,
            f"{stderr}\ncommand exceeded its {timeout:.2f}s timeout",
        )


def command_output(result):
    command = " ".join(result.args)
    return (
        f"$ {command}\n"
        f"exit: {result.returncode}\n"
        f"stdout:\n{result.stdout}\n"
        f"stderr:\n{result.stderr}"
    )


def command_before(deadline, *args):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return subprocess.CompletedProcess(
            [ADB, *args],
            125,
            "",
            "command skipped because the uiautomator attempt deadline elapsed",
        )
    return adb(*args, timeout=remaining)


def node_center(bounds):
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds or "")
    if match is None:
        return None
    return (
        (int(match.group(1)) + int(match.group(3))) // 2,
        (int(match.group(2)) + int(match.group(4))) // 2,
    )


def dump_nodes(timeout=UI_DUMP_ATTEMPT_TIMEOUT):
    deadline = time.monotonic() + timeout
    failures = []
    delay = UI_DUMP_INITIAL_DELAY
    attempts = 0
    while True:
        attempts += 1
        cleared = command_before(deadline, "shell", "rm", "-f", UI_DUMP_PATH)
        dumped = command_before(deadline, "shell", "uiautomator", "dump", UI_DUMP_PATH)
        landed = command_before(deadline, "shell", "test", "-s", UI_DUMP_PATH)
        read = command_before(deadline, "shell", "cat", UI_DUMP_PATH)
        raw = read.stdout
        details = "\n\n".join(
            (
                command_output(cleared),
                command_output(dumped),
                command_output(landed),
                command_output(read),
                f"raw dump:\n{raw}",
            )
        )

        if (
            cleared.returncode == 0
            and dumped.returncode == 0
            and landed.returncode == 0
            and read.returncode == 0
        ):
            try:
                root = ET.fromstring(raw)
                if root.tag != "hierarchy":
                    raise ET.ParseError(f"expected hierarchy root, got {root.tag!r}")
                nodes = []
                for element in root.iter("node"):
                    center = node_center(element.get("bounds"))
                    nodes.append(
                        {
                            "text": element.get("text", ""),
                            "desc": element.get("content-desc", ""),
                            "id": element.get("resource-id", ""),
                            "clickable": element.get("clickable", ""),
                            "checked": element.get("checked", ""),
                            "center": center,
                        }
                    )
                return nodes, raw
            except ET.ParseError as error:
                failures.append(f"uiautomator XML parse failure: {error}\n{details}")
        else:
            failures.append(f"uiautomator dump did not land\n{details}")

        if len(failures) > UI_DUMP_FAILURES_TO_REPORT:
            failures.pop(0)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(delay, remaining))
        delay = min(delay * 2, UI_DUMP_MAX_DELAY)

    raise RuntimeError(
        f"uiautomator did not produce well-formed XML after {attempts} attempts "
        f"within {timeout}s; showing the last {len(failures)} attempt(s):\n\n"
        + "\n\n--- retry ---\n\n".join(failures)
    )


def matches(node, query):
    haystack = f"{node['text']} {node['desc']} {node['id']}".casefold()
    return query.casefold() in haystack


def first_match(nodes, queries):
    candidates = [
        node
        for node in nodes
        if node["center"] is not None and any(matches(node, query) for query in queries)
    ]
    return next((node for node in candidates if node["clickable"] == "true"), None) or (
        candidates[0] if candidates else None
    )


def remote_debugging_state(nodes, remote):
    if remote["center"] is None:
        return None
    remote_y = remote["center"][1]
    for node in nodes:
        if node["checked"] == "true" and node["center"] is not None:
            if abs(node["center"][1] - remote_y) <= 80:
                return True
    if remote["checked"] == "false":
        return False
    return None


def dismiss_system_dialog(nodes):
    title = first_match(nodes, ("isn't responding", "is not responding"))
    close = first_match(nodes, ("close app",))
    if title is None or close is None:
        return False
    tap_node(close)
    return True


def tap_node(node):
    if node["center"] is None:
        raise RuntimeError(f"node has no bounds: {node}")
    result = adb("shell", "input", "tap", *(str(value) for value in node["center"]))
    if result.returncode != 0:
        raise RuntimeError(f"tap failed\n{command_output(result)}")


def swipe(direction):
    if direction == "down":
        coordinates = ("540", "1800", "540", "600")
    else:
        coordinates = ("540", "600", "540", "1800")
    result = adb("shell", "input", "swipe", *coordinates, "300")
    if result.returncode != 0:
        raise RuntimeError(f"scroll failed\n{command_output(result)}")


def press_back():
    result = adb("shell", "input", "keyevent", "4")
    if result.returncode != 0:
        raise RuntimeError(f"back navigation failed\n{command_output(result)}")


def wait_for_node(queries, timeout):
    deadline = time.monotonic() + timeout
    last_raw = ""
    last_error = ""
    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        try:
            nodes, last_raw = dump_nodes(min(UI_DUMP_ATTEMPT_TIMEOUT, remaining))
        except RuntimeError as error:
            last_error = str(error)
            time.sleep(min(UI_DUMP_INITIAL_DELAY, max(0, deadline - time.monotonic())))
            continue
        if dismiss_system_dialog(nodes):
            time.sleep(0.5)
            continue
        node = first_match(nodes, queries)
        if node is not None:
            return node, last_raw
        time.sleep(0.25)
    raise RuntimeError(
        f"Fenix UI did not expose any of {queries!r} within {timeout}s:\n"
        f"raw dump:\n{last_raw}\n\nlast dump failure:\n{last_error}"
    )


def wait_for_ui_ready(timeout=UI_READY_TIMEOUT):
    deadline = time.monotonic() + timeout
    last_error = ""
    while time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        try:
            nodes, raw = dump_nodes(min(UI_DUMP_ATTEMPT_TIMEOUT, remaining))
        except RuntimeError as error:
            last_error = str(error)
            time.sleep(min(UI_DUMP_INITIAL_DELAY, max(0, deadline - time.monotonic())))
            continue
        if nodes:
            return nodes, raw
        time.sleep(UI_DUMP_INITIAL_DELAY)
    raise RuntimeError(
        f"Fenix did not expose a usable accessibility hierarchy within {timeout}s:\n{last_error}"
    )


def find_after_scrolling(queries, scrolls=16):
    last_raw = ""
    for _ in range(scrolls):
        nodes, last_raw = wait_for_ui_ready()
        if dismiss_system_dialog(nodes):
            time.sleep(0.5)
            continue
        node = first_match(nodes, queries)
        if node is not None:
            return node, nodes, last_raw
        swipe("down")
        time.sleep(0.25)
    return None, None, last_raw


def scroll_to_top(scrolls=20):
    for _ in range(scrolls):
        swipe("up")
        time.sleep(0.15)


def open_settings():
    last_error = ""
    for attempt in range(SETTINGS_ROUTE_ATTEMPTS):
        nodes, _ = wait_for_ui_ready()
        if dismiss_system_dialog(nodes):
            time.sleep(0.5)
            continue
        settings = first_match(nodes, ("settings",))
        if settings is not None:
            return settings

        try:
            menu, _ = wait_for_node(("more options", "menu"), SETTINGS_MENU_TIMEOUT)
            tap_node(menu)
            settings, _ = wait_for_node(("settings",), SETTINGS_ITEM_TIMEOUT)
            return settings
        except RuntimeError as error:
            last_error = str(error)
            try:
                press_back()
            except RuntimeError as back_error:
                last_error += f"\nback navigation after menu route failed: {back_error}"
            time.sleep(0.5 * (attempt + 1))

    raise RuntimeError(
        f"Fenix did not expose Settings after {SETTINGS_ROUTE_ATTEMPTS} menu routes:\n{last_error}"
    )


def open_secret_settings():
    scroll_to_top()
    about, _, raw = find_after_scrolling(("about firefox", "about"), 20)
    if about is None:
        raise RuntimeError(f"Fenix settings did not expose About Firefox:\nraw dump:\n{raw}")
    tap_node(about)

    remote, _, _ = find_after_scrolling(("remote debugging via usb", "remote debugging"), 8)
    if remote is not None:
        return

    scroll_to_top()
    logo, _ = wait_for_node(("firefox logo",), 20)
    for _ in range(5):
        tap_node(logo)
        time.sleep(0.15)

    press_back()
    wait_for_node(("settings",), 20)
    secret, _, raw = find_after_scrolling(
        ("secret settings", "developer settings", "debug settings"), 16
    )
    if secret is None:
        raise RuntimeError(f"Fenix settings did not expose Secret Settings:\nraw dump:\n{raw}")
    tap_node(secret)


def enable_remote_debugging():
    remote_labels = ("remote debugging via usb", "remote debugging")
    nodes, raw = wait_for_ui_ready()
    if dismiss_system_dialog(nodes):
        nodes, raw = wait_for_ui_ready()
    remote = first_match(nodes, remote_labels)
    if remote is None:
        settings = open_settings()
        tap_node(settings)

        remote, nodes, raw = find_after_scrolling(remote_labels)
        if remote is None:
            open_secret_settings()
            remote, nodes, raw = find_after_scrolling(remote_labels)
        if remote is None:
            raise RuntimeError(
                f"Fenix settings did not expose Remote debugging after scrolling:\nraw dump:\n{raw}"
            )

    if remote_debugging_state(nodes, remote) is True:
        return {"enabled": True, "changed": False, "label": remote["text"] or remote["desc"]}

    tap_node(remote)
    deadline = time.monotonic() + 15
    last_raw = raw
    while time.monotonic() < deadline:
        nodes, last_raw = wait_for_ui_ready()
        if dismiss_system_dialog(nodes):
            time.sleep(0.5)
            continue
        remote = first_match(nodes, remote_labels)
        if remote is None:
            time.sleep(0.25)
            continue
        state = remote_debugging_state(nodes, remote)
        if state is True:
            return {"enabled": True, "changed": True, "label": remote["text"] or remote["desc"]}
        if state is None:
            return {
                "enabled": None,
                "changed": True,
                "label": remote["text"] or remote["desc"],
            }
        time.sleep(0.25)

    raise RuntimeError(f"Fenix did not enable Remote debugging:\nraw dump:\n{last_raw}")


def print_node(node):
    x, y = node["center"] if node["center"] is not None else (None, None)
    print(
        f"({x},{y}) clickable={node['clickable']} checked={node['checked']} "
        f"text={node['text']!r} desc={node['desc']!r} id={node['id']!r}"
    )


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "list"
    if command == "enable-remote-debugging":
        print(json.dumps(enable_remote_debugging()))
        return

    nodes, _ = dump_nodes()
    if command == "list":
        for node in nodes:
            if node["text"] or node["desc"]:
                print_node(node)
    elif command == "find":
        query = sys.argv[2]
        for node in nodes:
            if matches(node, query):
                print_node(node)
    elif command == "tap":
        query = sys.argv[2]
        node = first_match(nodes, (query,))
        if node is None:
            print(f"NOT FOUND: {query}")
            return
        tap_node(node)
        print(f"TAPPED {node['center']} text={node['text']!r} desc={node['desc']!r}")
    elif command == "scroll":
        direction = sys.argv[2] if len(sys.argv) > 2 else "down"
        if direction not in ("up", "down"):
            raise RuntimeError(f"unsupported scroll direction: {direction}")
        swipe(direction)
        print(f"scrolled {direction}")
    else:
        raise RuntimeError(f"unsupported command: {command}")


if __name__ == "__main__":
    try:
        main()
    except (IndexError, RuntimeError, ET.ParseError) as error:
        print(f"Fenix UI automation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
