#!/usr/bin/env python3
"""Probe the Brave kiosk over CDP for a live, responsive dashboard page.

Default (probe) mode:
  Exit 0 = page responsive. Exit 2 = page hung (CDP up but Runtime.evaluate
  timed out or errored). Exit 3 = CDP unreachable / no page target.
  Prints a one-line JSON verdict to stdout for the guard to relay to indium.

`reload` mode: force Page.reload(ignoreCache) on the dashboard target. Used
by the guard as the gentle first recovery step before a full kill+relaunch.

Which tab counts as "the dashboard" is PARAMETERIZED via
~/.config/nova-kiosk/backend.env (NOVA_BACKEND_URL) — the same file the launch
wrapper uses — so a backend cutover can't strand the guard matching the old
URL and relaunch-looping.
"""
import json, os, sys, time, urllib.request, socket
import websocket  # python3-websocket

CDP = 'http://127.0.0.1:9223'
EVAL_TIMEOUT = 10.0
# A single slow answer is not a hang. The dashboard's renderer can miss one
# evaluate while it is busy (hydration after a reload, an HLS segment switch,
# a heavy repaint), and acting on that produced roughly 25 pointless
# reload/relaunch cycles a day on the kiosk. Only a page that fails EVERY
# attempt in a run counts as unresponsive.
EVAL_ATTEMPTS = 3
ATTEMPT_GAP = 3.0


def backend_url():
    path = os.path.expanduser('~/.config/nova-kiosk/backend.env')
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line.startswith('NOVA_BACKEND_URL='):
                    return line.split('=', 1)[1].strip().strip('"\'')
    except OSError:
        pass
    return 'http://127.0.0.1/'


BACKEND = backend_url().rstrip('/')


def http_json(path):
    with urllib.request.urlopen(CDP + path, timeout=4) as r:
        return json.load(r)


def pick_page():
    for t in http_json('/json/list'):
        if t.get('type') == 'page' and t.get('url', '').startswith(BACKEND):
            return t
    return None


def do_reload(ws_url):
    ws = websocket.create_connection(
        ws_url, timeout=4)
    try:
        ws.send(json.dumps({'id': 1, 'method': 'Page.enable'}))
        ws.send(json.dumps({'id': 2, 'method': 'Page.reload',
                            'params': {'ignoreCache': True}}))
        ws.settimeout(4)
        try:
            ws.recv()
        except Exception:
            pass
    finally:
        try:
            ws.close()
        except Exception:
            pass


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'probe'
    try:
        page = pick_page()
    except Exception as e:
        print(json.dumps({'ok': False, 'reason': 'cdp_unreachable', 'err': str(e)[:120]}))
        sys.exit(3)
    if not page:
        print(json.dumps({'ok': False, 'reason': 'no_page_target', 'backend': BACKEND}))
        sys.exit(3)
    ws_url = page['webSocketDebuggerUrl']
    if mode == 'reload':
        try:
            do_reload(ws_url)
            print(json.dumps({'ok': True, 'reason': 'reload_sent'}))
            sys.exit(0)
        except Exception as e:
            print(json.dumps({'ok': False, 'reason': 'reload_failed', 'err': str(e)[:120]}))
            sys.exit(2)
    last = {'ok': False, 'reason': 'eval_timeout'}
    for attempt in range(1, EVAL_ATTEMPTS + 1):
        ok, verdict = try_evaluate(ws_url)
        if ok:
            verdict['attempt'] = attempt
            print(json.dumps(verdict))
            sys.exit(0)
        last = verdict
        if attempt < EVAL_ATTEMPTS:
            time.sleep(ATTEMPT_GAP)
            # Re-resolve the target: a reload or a renderer swap gives the page
            # a new debugger socket, and reusing the old one looks like a hang.
            try:
                page = pick_page()
            except Exception:
                page = None
            if page:
                ws_url = page['webSocketDebuggerUrl']
    last['attempts'] = EVAL_ATTEMPTS
    print(json.dumps(last))
    sys.exit(2)


def try_evaluate(ws_url):
    """One responsiveness attempt. Returns (ok, verdict-dict)."""
    try:
        ws = websocket.create_connection(ws_url, timeout=4)
    except Exception as e:
        return False, {'ok': False, 'reason': 'ws_connect_fail', 'err': str(e)[:120]}
    try:
        # Ask the renderer to run trivial JS + report page visibility state.
        expr = ("JSON.stringify({v:1+1, hidden:document.hidden, "
                "rs:document.readyState, "
                "ov:!!document.querySelector('[data-nova-reconnect],.reconnect-overlay')})")
        ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate',
                            'params': {'expression': expr, 'returnByValue': True}}))
        ws.settimeout(EVAL_TIMEOUT)
        deadline = time.time() + EVAL_TIMEOUT
        while time.time() < deadline:
            msg = json.loads(ws.recv())
            if msg.get('id') == 1:
                res = msg.get('result', {}).get('result', {}).get('value')
                return True, {'ok': True, 'reason': 'responsive', 'eval': res}
        return False, {'ok': False, 'reason': 'eval_timeout'}
    except (websocket.WebSocketTimeoutException, socket.timeout):
        return False, {'ok': False, 'reason': 'eval_timeout'}
    except Exception as e:
        return False, {'ok': False, 'reason': 'eval_error', 'err': str(e)[:120]}
    finally:
        try:
            ws.close()
        except Exception:
            pass


if __name__ == '__main__':
    main()
