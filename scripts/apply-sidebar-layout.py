#!/usr/bin/env python3
"""One-time layout transform: sidebar + atlas-main. Preserves all IDs and links."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

ASIDE = """      <aside class="app-sidebar" aria-label="Main navigation">
        <div class="sidebar-brand">
          <div class="sidebar-brand-kicker">PS-ETW</div>
          <div class="sidebar-brand-title">ATLAS</div>
          <div class="sidebar-brand-line"></div>
        </div>
        <nav class="nav nav-sidebar" aria-label="Primary">
          <div class="sidebar-nav-group-label">Main</div>
          <a data-nav href="index.html" title="Executive Dashboard">Dashboard</a>
          <a data-nav href="project-setup.html" title="Project Setup">Project Setup</a>
          <a data-nav href="activities.html" title="Activity Master">Activities</a>
          <a data-nav href="calendar.html" title="Calendar">Calendar</a>
          <div class="sidebar-nav-group-label">Planning</div>
          <a data-nav href="gantt.html" title="Gantt &amp; Dependencies">Gantt</a>
          <a data-nav href="network.html" title="Network Diagram">Network</a>
          <a data-nav href="materials.html" title="Material Intelligence">Materials</a>
          <a data-nav href="engine-description.html" title="Engine Description">Engine Desc.</a>
          <div class="sidebar-nav-group-label">Analytics</div>
          <a data-nav href="intelligence.html" title="Delay, Risk &amp; Optimization">Delay &amp; Risk</a>
          <a data-nav href="risk-register.html" title="Risk Register">Risk Register</a>
          <div class="sidebar-nav-group-label">Management</div>
          <a data-nav href="anomaly-center.html" title="Anomaly, Baseline &amp; Actions">Anomaly Center</a>
        </nav>
      </aside>
      <div class="atlas-main">
"""

FILES = [
    "index.html",
    "activities.html",
    "gantt.html",
    "calendar.html",
    "network.html",
    "materials.html",
    "intelligence.html",
    "risk-register.html",
    "anomaly-center.html",
    "project-setup.html",
    "engine-description.html",
]


def transform(html: str) -> str:
    if "atlas-layout" in html:
        return html  # idempotent

    m = re.search(r'<div class="(app-shell(?:\s+app-shell-wide)?)">\s*<header class="([^"]*)"', html, re.DOTALL)
    if not m:
        raise ValueError("Could not find app-shell + header pattern")

    shell_classes = m.group(1)
    header_classes = m.group(2)
    if "atlas-top-header" not in header_classes:
        header_classes = header_classes + " atlas-top-header"

    html = html.replace(m.group(0), f'<div class="atlas-layout page-content">\n{ASIDE}      <header class="{header_classes}"', 1)

    # Remove first top nav strip (horizontal)
    html = re.sub(
        r'</header>\s*<nav class="nav[^"]*"[^>]*aria-label="Primary"[^>]*>[\s\S]*?</nav>\s*',
        f"</header>\n\n      <div class=\"{shell_classes}\">\n      ",
        html,
        count=1,
    )

    # Close atlas-main + atlas-layout: insert 2 </div> before first script (keep single app-shell closer)
    for pat in (
        "\n    <script type=\"module\"",
        "\n    <script src=",
    ):
        idx = html.find(pat)
        if idx == -1:
            continue
        # Walk back to line start before script; require preceding </div>
        before = html.rfind("\n    </div>", 0, idx)
        if before == -1:
            continue
        insert = "\n    </div>\n    </div>"
        html = html[:before] + insert + html[before:]
        break
    else:
        raise ValueError("Could not find closing pattern before script")
    return html


def main():
    for name in FILES:
        p = ROOT / name
        if not p.exists():
            print("skip", name)
            continue
        text = p.read_text()
        try:
            new = transform(text)
        except ValueError as e:
            print("FAIL", name, e)
            continue
        p.write_text(new)
        print("OK", name)


if __name__ == "__main__":
    main()
