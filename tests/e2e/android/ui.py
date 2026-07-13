#!/usr/bin/env python3
"""Headless Fenix UI driver via uiautomator (no pixels needed).
Usage: ui.py list | ui.py find <text> | ui.py tap <text> | ui.py scroll [up|down]
Matches text / content-desc / resource-id (case-insensitive substring)."""
import subprocess, sys, re

SDK = "/opt/homebrew/share/android-commandlinetools"
ADB = f"{SDK}/platform-tools/adb"


def adb(*a):
    return subprocess.run([ADB, *a], capture_output=True, text=True)


def dump():
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
    adb("pull", "/sdcard/ui.xml", "/tmp/ui.xml")
    try:
        return open("/tmp/ui.xml").read()
    except FileNotFoundError:
        return ""


def nodes(xml):
    out = []
    for m in re.finditer(r"<node[^>]*>", xml):
        n = m.group(0)
        g = lambda k: (re.search(k + r'="([^"]*)"', n) or [None, ""])[1]
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
        cx = cy = None
        if b:
            cx = (int(b.group(1)) + int(b.group(3))) // 2
            cy = (int(b.group(2)) + int(b.group(4))) // 2
        out.append(
            {"text": g("text"), "desc": g("content-desc"), "id": g("resource-id"),
             "clk": g("clickable"), "cx": cx, "cy": cy}
        )
    return out


def match(n, q):
    return q in f"{n['text']} {n['desc']} {n['id']}".lower()


cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
ns = nodes(dump())

if cmd == "list":
    for n in ns:
        if n["text"] or n["desc"]:
            print(f"({n['cx']},{n['cy']}) clk={n['clk']} text='{n['text']}' desc='{n['desc']}' id='{n['id']}'")
elif cmd == "find":
    q = sys.argv[2].lower()
    for n in ns:
        if match(n, q):
            print(f"({n['cx']},{n['cy']}) text='{n['text']}' desc='{n['desc']}' id='{n['id']}'")
elif cmd == "tap":
    q = sys.argv[2].lower()
    for n in ns:
        if match(n, q) and n["cx"] is not None:
            adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
            print(f"TAPPED ({n['cx']},{n['cy']}) text='{n['text']}' desc='{n['desc']}' id='{n['id']}'")
            break
    else:
        print(f"NOT FOUND: {q}")
elif cmd == "scroll":
    direction = sys.argv[2] if len(sys.argv) > 2 else "down"
    if direction == "down":
        adb("shell", "input", "swipe", "160", "500", "160", "150", "300")
    else:
        adb("shell", "input", "swipe", "160", "150", "160", "500", "300")
    print(f"scrolled {direction}")
