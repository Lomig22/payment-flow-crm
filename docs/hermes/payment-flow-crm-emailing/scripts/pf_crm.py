#!/usr/bin/env python3
"""Accès de Hermès au CRM Payment Flow (emailing). La clé est lue dans un fichier protégé,
jamais affichée. Usage :
  pf_crm.py next [limite]            mails à envoyer (JSON)
  pf_crm.py event '<json>'           un événement ou {"events": [...]} (sent, opened, replied…)
  pf_crm.py release <lead_id> …      leads remis mais non envoyés
  pf_crm.py stats                    indicateurs (envois du jour, taux d'ouverture et de réponse)
"""
import json, sys, urllib.request, urllib.error
from pathlib import Path

BASE = "https://payment-flow-crm-delta.vercel.app/api/emailing/agent"
KEY = Path("/root/.hermes/secrets/pf_crm_emailing.key").read_text().strip()

def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return {"error": e.code, "message": e.read().decode(errors="replace")[:500]}

if __name__ == "__main__":
    cmd, args = (sys.argv[1] if len(sys.argv) > 1 else "help"), sys.argv[2:]
    if cmd == "next":
        out = call("GET", f"/next?limit={int(args[0]) if args else 50}")
    elif cmd == "event":
        out = call("POST", "/events", json.loads(args[0]))
    elif cmd == "release":
        out = call("POST", "/release", {"lead_ids": args})
    elif cmd == "stats":
        out = call("GET", "/stats")
    else:
        print(__doc__); sys.exit(1)
    print(json.dumps(out, ensure_ascii=False, indent=2))
