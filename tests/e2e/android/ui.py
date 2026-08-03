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
RETRY_DELAYS = (0.2, 0.4, 0.8, 1.0, 1.0, 1.0)


def adb(*args):
    return subprocess.run([ADB, *args], capture_output=True, text=True)


def command_output(result):
    command = " ".join(result.args)
    return (
        f"$ {command}\n"
        f"exit: {result.returncode}\n"
        f"stdout:\n{result.stdout}\n"
        f"stderr:\n{result.stderr}"
    )


def node_center(bounds):
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds or "")
    if match is None:
        return None
    return (
        (int(match.group(1)) + int(match.group(3))) // 2,
        (int(match.group(2)) + int(match.group(4))) // 2,
    )


def dump_nodes():
    failures = []
    for delay in RETRY_DELAYS:
        adb("shell", "rm", "-f", UI_DUMP_PATH)
        dumped = adb("shell", "uiautomator", "dump", UI_DUMP_PATH)
        landed = adb("shell", "test", "-s", UI_DUMP_PATH)
        read = adb("shell", "cat", UI_DUMP_PATH)
        raw = read.stdout
        details = "\n\n".join(
            (
                command_output(dumped),
                command_output(landed),
                command_output(read),
                f"raw dump:\n{raw}",
            )
        )

        if dumped.returncode == 0 and landed.returncode == 0 and read.returncode == 0:
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
        time.sleep(delay)
    raise RuntimeError(
        "uiautomator did not produce well-formed XML after retries:\n\n"
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


def wait_for_node(queries, timeout):
    deadline = time.monotonic() + timeout
    last_raw = ""
    while time.monotonic() < deadline:
        nodes, last_raw = dump_nodes()
        if dismiss_system_dialog(nodes):
            time.sleep(0.5)
            continue
        node = first_match(nodes, queries)
        if node is not None:
            return node, last_raw
        time.sleep(0.25)
    raise RuntimeError(
        f"Fenix UI did not expose any of {queries!r} within {timeout}s:\nraw dump:\n{last_raw}"
    )


def enable_remote_debugging():
    remote_labels = ("remote debugging via usb", "remote debugging")
    nodes, raw = dump_nodes()
    if dismiss_system_dialog(nodes):
        nodes, raw = dump_nodes()
    remote = first_match(nodes, remote_labels)
    if remote is None:
        menu, _ = wait_for_node(("more options", "menu"), 45)
        tap_node(menu)
        settings, _ = wait_for_node(("settings",), 20)
        tap_node(settings)

        for _ in range(16):
            nodes, raw = dump_nodes()
            if dismiss_system_dialog(nodes):
                time.sleep(0.5)
                continue
            remote = first_match(nodes, remote_labels)
            if remote is not None:
                break
            swipe("down")
            time.sleep(0.25)
        else:
            raise RuntimeError(
                f"Fenix settings did not expose Remote debugging after scrolling:\nraw dump:\n{raw}"
            )

    if remote_debugging_state(nodes, remote) is True:
        return {"enabled": True, "changed": False, "label": remote["text"] or remote["desc"]}

    tap_node(remote)
    deadline = time.monotonic() + 15
    last_raw = raw
    while time.monotonic() < deadline:
        nodes, last_raw = dump_nodes()
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
    except (IndexError, RuntimeError) as error:
        print(f"Fenix UI automation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
