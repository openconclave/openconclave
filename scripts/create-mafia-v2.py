"""Create Mafia Game v2 workflow using discussion node for day discussion."""
import json, urllib.request

API = "http://localhost:4000"

# ── Agent system prompts (private to each agent) ──────────────

PROMPTS = {
    "rowan": (
        "You are Rowan playing Mafia. You are the GODFATHER (Mafia leader). "
        "You appear INNOCENT to the Detective.\n"
        "Your Mafia teammates: Elara and Soren.\n"
        "Rules: 9 players, Town (6) vs Mafia (3). Town wins when all Mafia eliminated. "
        "Mafia wins when mafia >= town.\n"
        "NEVER reveal you are Mafia. Blend in, deflect suspicion, subtly direct votes toward Town.\n"
        "Keep responses to 2-3 sentences max."
    ),
    "elara": (
        "You are Elara playing Mafia. You are MAFIA.\n"
        "Your teammates: Rowan (Godfather) and Soren.\n"
        "Rules: 9 players, Town (6) vs Mafia (3). Mafia wins when mafia >= town.\n"
        "NEVER reveal you are Mafia. Blend in during day. Support teammates subtly.\n"
        "Keep responses to 2-3 sentences max."
    ),
    "soren": (
        "You are Soren playing Mafia. You are MAFIA.\n"
        "Your teammates: Rowan (Godfather) and Elara.\n"
        "Rules: 9 players, Town (6) vs Mafia (3). Mafia wins when mafia >= town.\n"
        "NEVER reveal you are Mafia. Blend in during day. Support teammates subtly.\n"
        "Keep responses to 2-3 sentences max."
    ),
    "mira": (
        "You are Mira playing Mafia. You are the DETECTIVE (Town).\n"
        "Each night you investigate one player: GUILTY (Mafia) or INNOCENT (Town/Godfather). "
        "WARNING: The Godfather appears INNOCENT.\n"
        "Rules: 9 players, Town (6) vs Mafia (3). Town wins when all Mafia eliminated.\n"
        "Share findings strategically -- revealing too early makes you a target.\n"
        "Keep responses to 2-3 sentences max."
    ),
    "kael": (
        "You are Kael playing Mafia. You are the DOCTOR (Town).\n"
        "Each night you protect one player from being killed. "
        "Cannot protect the same player two nights in a row.\n"
        "Rules: 9 players, Town (6) vs Mafia (3). Town wins when all Mafia eliminated.\n"
        "Protect likely targets. Don't reveal your role unless necessary.\n"
        "Keep responses to 2-3 sentences max."
    ),
}
# Townspeople share a template
for name in ("orion", "nico", "linnea", "talia"):
    PROMPTS[name] = (
        f"You are {name.capitalize()} playing Mafia. You are a TOWNSPERSON (Town). No special abilities.\n"
        "Rules: 9 players, Town (6) vs Mafia (3). Town wins when all Mafia eliminated.\n"
        "Use logic and discussion to find Mafia. Watch for deflection and suspicious behavior.\n"
        "Keep responses to 2-3 sentences max."
    )

# ── Agent nodes ───────────────────────────────────────────────

AGENT_NAMES = ["rowan", "elara", "soren", "mira", "kael", "orion", "nico", "linnea", "talia"]

agents = []
for i, name in enumerate(AGENT_NAMES):
    agents.append({
        "id": name,
        "type": "agent",
        "position": {"x": -100, "y": 200 + i * 120},
        "data": {
            "label": name.capitalize(),
            "type": "agent",
            "config": {
                "engine": "claude",
                "model": "haiku",
                "systemPrompt": PROMPTS[name],
                "maxTurns": 5,
                "maxBudgetUsd": 0.50,
                "tools": [],
            },
        },
    })

# ── Setup node ────────────────────────────────────────────────

SETUP_CODE = r'''import json, sys

data = json.load(sys.stdin)

players = [
    {"id": 1, "name": "Rowan",  "nodeId": "rowan",  "role": "godfather",   "faction": "mafia", "alive": True, "eliminated_day": None},
    {"id": 2, "name": "Elara",  "nodeId": "elara",  "role": "mafia",       "faction": "mafia", "alive": True, "eliminated_day": None},
    {"id": 3, "name": "Soren",  "nodeId": "soren",  "role": "mafia",       "faction": "mafia", "alive": True, "eliminated_day": None},
    {"id": 4, "name": "Mira",   "nodeId": "mira",   "role": "detective",   "faction": "town",  "alive": True, "eliminated_day": None},
    {"id": 5, "name": "Kael",   "nodeId": "kael",   "role": "doctor",      "faction": "town",  "alive": True, "eliminated_day": None},
    {"id": 6, "name": "Orion",  "nodeId": "orion",  "role": "townsperson", "faction": "town",  "alive": True, "eliminated_day": None},
    {"id": 7, "name": "Nico",   "nodeId": "nico",   "role": "townsperson", "faction": "town",  "alive": True, "eliminated_day": None},
    {"id": 8, "name": "Linnea", "nodeId": "linnea", "role": "townsperson", "faction": "town",  "alive": True, "eliminated_day": None},
    {"id": 9, "name": "Talia",  "nodeId": "talia",  "role": "townsperson", "faction": "town",  "alive": True, "eliminated_day": None},
]

living_names = ", ".join(p["name"] for p in players)

state = {
    "players": players,
    "day": 1,
    "phase": "day_chat",
    "chat_log": [],
    "votes": [],
    "night_log": [],
    "eliminations": [],
    "winner": None,
    "last_protected": None,
    "daySummary": f"Day 1. All players alive: {living_names}. Discuss who might be Mafia.",
}

print(json.dumps(state))
'''

# ── Discussion moderator code ─────────────────────────────────

MODERATOR_CODE = r'''import json, sys

data = json.load(sys.stdin)
responses = data["responses"]
state = data["input"]

living = [p for p in state["players"] if p["alive"]]
living_names = [p["name"] for p in living]
living_set = set(living_names)

spoken = set()
for r in responses:
    if r["agentName"] in living_set:
        spoken.add(r["agentName"])

# If last speaker was dead, skip them
last = responses[-1]["agentName"] if responses else None
if last and last not in living_set:
    remaining = [n for n in living_names if n not in spoken]
    if remaining:
        print(json.dumps({"action": "call_specific", "nextAgent": remaining[0]}))
    else:
        print(json.dumps({"action": "end_discussion", "summary": "Time to vote."}))
    sys.exit(0)

remaining = [n for n in living_names if n not in spoken]
if remaining:
    print(json.dumps({"action": "call_specific", "nextAgent": remaining[0]}))
else:
    print(json.dumps({"action": "end_discussion", "summary": "Discussion closed. Time to vote."}))
'''

# ── Discussion prompt template ────────────────────────────────

DISCUSSION_PROMPT = (
    "You are {{agentName}} in a Mafia game. {{input.daySummary}}\n\n"
    "{{transcript}}\n\n"
    "If you have been eliminated, respond only: \"...\"\n"
    "Otherwise, give your day speech (2-3 sentences). Be strategic based on your role."
)

# ── Day Vote code ─────────────────────────────────────────────

DAY_VOTE_CODE = r'''import json, sys, os, random, urllib.request
from collections import Counter

data = json.load(sys.stdin)
disc = data["input"]
state = disc["input"]
transcript = disc.get("transcript", "")

api_url = os.environ["OC_API_URL"]
wf_id = os.environ["OC_WORKFLOW_ID"]
run_id = os.environ["OC_RUN_ID"]

def call_agent(node_id, prompt, tools=None):
    body = {"workflowId": int(wf_id), "runId": int(run_id), "nodeId": node_id, "prompt": prompt}
    if tools:
        body["tools"] = tools
    req = urllib.request.Request(
        f"{api_url}/api/agents/invoke",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read())
    if "tool_call" in result:
        return result["tool_call"]["input"]
    return result["output"]

if state.get("winner"):
    print(json.dumps(state))
    sys.exit(0)

pm = {p["id"]: p for p in state["players"]}
living = [p for p in state["players"] if p["alive"]]

ROLE_HINTS = {
    "godfather": "You are Mafia. Vote to protect your team.",
    "mafia": "You are Mafia. Vote to protect your team.",
    "detective": "Use investigation clues to guide your vote.",
    "doctor": "Vote for whoever seems most suspicious.",
    "townsperson": "Vote for whoever seems most suspicious.",
}

random.shuffle(living)
day_votes = []

for player in living:
    others = [p for p in living if p["id"] != player["id"]]
    others_names = [p["name"] for p in others]

    votes_so_far = ""
    for v in day_votes:
        votes_so_far += f"- {pm[v['voter']]['name']} voted for {pm[v['target']]['name']}\n"

    prompt = f"# Mafia -- Day {state['day']} Vote\n\n"
    prompt += f"You are **{player['name']}**. {ROLE_HINTS[player['role']]}\n\n"

    if player["faction"] == "mafia":
        mates = [p["name"] for p in state["players"] if p["faction"] == "mafia" and p["id"] != player["id"]]
        prompt += f"Mafia teammates: {', '.join(mates)}\n\n"

    prompt += f"## Today's Discussion\n{transcript}\n\n"
    if votes_so_far:
        prompt += f"## Votes So Far\n{votes_so_far}\n"
    prompt += "Vote to eliminate one player."

    tool = {
        "name": "vote",
        "description": "Cast your vote",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_name": {"type": "string", "enum": others_names, "description": "Player to eliminate"}
            },
            "required": ["player_name"]
        }
    }

    result = call_agent(player["nodeId"], prompt, tools=[tool])
    voted_name = result["player_name"] if isinstance(result, dict) else str(result)

    target_id = None
    for p in others:
        if p["name"] == voted_name:
            target_id = p["id"]
            break
    if target_id is None:
        target_id = random.choice(others)["id"]

    day_votes.append({"voter": player["id"], "target": target_id})
    state["votes"].append({"day": state["day"], "voter_id": player["id"], "target_id": target_id})

# Tally
counts = Counter(v["target"] for v in day_votes)
top = counts.most_common(2)

eliminated_name = None
if len(top) >= 2 and top[0][1] == top[1][1]:
    pass  # tie
else:
    elim_id = top[0][0]
    for p in state["players"]:
        if p["id"] == elim_id:
            p["alive"] = False
            p["eliminated_day"] = state["day"]
            eliminated_name = p["name"]
    state["eliminations"].append({"day": state["day"], "player_id": elim_id, "method": "vote"})

state["chat_log"].append({"day": state["day"], "transcript": transcript})

# Win check
living_after = [p for p in state["players"] if p["alive"]]
mafia_alive = [p for p in living_after if p["faction"] == "mafia"]
town_alive = [p for p in living_after if p["faction"] == "town"]

if len(mafia_alive) == 0:
    state["winner"] = "town"
    state["phase"] = "finished"
elif len(mafia_alive) >= len(town_alive):
    state["winner"] = "mafia"
    state["phase"] = "finished"

print(json.dumps(state))
'''

# ── Night Phase code ──────────────────────────────────────────

NIGHT_CODE = r'''import json, sys, os, random, urllib.request
from collections import Counter

data = json.load(sys.stdin)
state = data["input"]

if state.get("winner"):
    print(json.dumps(state))
    sys.exit(0)

api_url = os.environ["OC_API_URL"]
wf_id = os.environ["OC_WORKFLOW_ID"]
run_id = os.environ["OC_RUN_ID"]

def call_agent(node_id, prompt, tools=None):
    body = {"workflowId": int(wf_id), "runId": int(run_id), "nodeId": node_id, "prompt": prompt}
    if tools:
        body["tools"] = tools
    req = urllib.request.Request(
        f"{api_url}/api/agents/invoke",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read())
    if "tool_call" in result:
        return result["tool_call"]["input"]
    return result["output"]

pm = {p["id"]: p for p in state["players"]}
living = [p for p in state["players"] if p["alive"]]

# === MAFIA ===
living_mafia = [p for p in living if p["faction"] == "mafia"]
non_mafia = [p for p in living if p["faction"] != "mafia"]

kill_votes = []
mafia_chat = []
kill_target_id = None

if living_mafia and non_mafia:
    target_names = [p["name"] for p in non_mafia]
    teammates = ", ".join(f"{p['name']} ({p['role']})" for p in living_mafia)

    for maf in living_mafia:
        chat_so_far = "\n".join(f"**{e['name']}:** {e['msg']}" for e in mafia_chat)

        prompt = f"# Mafia Night {state['day']}\n\n"
        prompt += f"You are **{maf['name']}** ({maf['role']}). Teammates: {teammates}\n"
        prompt += f"Town targets: {', '.join(target_names)}\n\n"
        if chat_so_far:
            prompt += f"## Mafia Chat\n{chat_so_far}\n\n"
        prompt += "Discuss and vote who to kill tonight."

        tool = {
            "name": "mafia_action",
            "description": "Chat and vote",
            "input_schema": {
                "type": "object",
                "properties": {
                    "message": {"type": "string", "description": "Message to teammates"},
                    "kill_target": {"type": "string", "enum": target_names, "description": "Player to kill"}
                },
                "required": ["message", "kill_target"]
            }
        }

        result = call_agent(maf["nodeId"], prompt, tools=[tool])
        msg = result.get("message", "") if isinstance(result, dict) else str(result)
        kill_name = result.get("kill_target") if isinstance(result, dict) else None

        tid = None
        if kill_name:
            for p in non_mafia:
                if p["name"] == kill_name:
                    tid = p["id"]
                    break
        if tid is None:
            tid = random.choice(non_mafia)["id"]

        mafia_chat.append({"name": maf["name"], "msg": msg})
        kill_votes.append(tid)
        state["night_log"].append({
            "day": state["day"], "action": "mafia_chat",
            "player_id": maf["id"], "content": msg, "visibility": "faction"
        })

    counts = Counter(kill_votes)
    top_count = counts.most_common(1)[0][1]
    tied = [t for t, c in counts.items() if c == top_count]
    kill_target_id = random.choice(tied)

# === DETECTIVE ===
detective = next((p for p in living if p["role"] == "detective"), None)
if detective:
    others = [p for p in living if p["id"] != detective["id"]]
    others_names = [p["name"] for p in others]

    past_inv = ""
    for e in state["night_log"]:
        if e.get("action") == "investigate" and e.get("player_id") == detective["id"]:
            past_inv += f"- Night {e['day']}: {pm[e['target_id']]['name']} = {e['result'].upper()}\n"

    prompt = f"# Detective Night {state['day']}\n\n"
    prompt += f"You are **{detective['name']}**, Detective.\n"
    prompt += f"Living: {', '.join(p['name'] for p in living)}\n\n"
    if past_inv:
        prompt += f"## Past Investigations\n{past_inv}\n"
    prompt += "Choose one player to investigate."

    tool = {
        "name": "investigate",
        "description": "Investigate a player",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_name": {"type": "string", "enum": others_names}
            },
            "required": ["player_name"]
        }
    }

    result = call_agent(detective["nodeId"], prompt, tools=[tool])
    inv_name = result["player_name"] if isinstance(result, dict) else str(result)

    inv_target = None
    for p in others:
        if p["name"] == inv_name:
            inv_target = p
            break
    if inv_target is None:
        inv_target = random.choice(others)

    inv_result = "innocent" if inv_target["role"] == "godfather" or inv_target["faction"] == "town" else "guilty"

    state["night_log"].append({
        "day": state["day"], "action": "investigate",
        "player_id": detective["id"], "target_id": inv_target["id"],
        "result": inv_result, "visibility": "self"
    })

# === DOCTOR ===
doctor = next((p for p in living if p["role"] == "doctor"), None)
protected_id = None
if doctor:
    others = [p for p in living if p["id"] != doctor["id"]]
    if state.get("last_protected") is not None:
        others = [p for p in others if p["id"] != state["last_protected"]]
    others_names = [p["name"] for p in others]

    prompt = f"# Doctor Night {state['day']}\n\n"
    prompt += f"You are **{doctor['name']}**, Doctor.\n"
    prompt += f"Cannot protect same player two nights in a row.\n"
    prompt += f"Living: {', '.join(p['name'] for p in living)}\n\n"
    if state.get("last_protected") and state["last_protected"] in pm:
        prompt += f"*(Last protected: {pm[state['last_protected']]['name']})*\n\n"
    prompt += "Choose one player to protect tonight."

    tool = {
        "name": "protect",
        "description": "Protect a player",
        "input_schema": {
            "type": "object",
            "properties": {
                "player_name": {"type": "string", "enum": others_names}
            },
            "required": ["player_name"]
        }
    }

    result = call_agent(doctor["nodeId"], prompt, tools=[tool])
    prot_name = result["player_name"] if isinstance(result, dict) else str(result)

    prot_target = None
    for p in others:
        if p["name"] == prot_name:
            prot_target = p
            break
    if prot_target is None:
        prot_target = random.choice(others)

    protected_id = prot_target["id"]
    state["last_protected"] = protected_id
    state["night_log"].append({
        "day": state["day"], "action": "protect",
        "player_id": doctor["id"], "target_id": protected_id, "visibility": "self"
    })

# === RESOLVE NIGHT ===
if kill_target_id is not None:
    was_protected = (kill_target_id == protected_id)
    state["night_log"].append({
        "day": state["day"], "action": "mafia_kill",
        "target_id": kill_target_id, "protected": was_protected, "visibility": "public"
    })
    if not was_protected:
        for p in state["players"]:
            if p["id"] == kill_target_id:
                p["alive"] = False
                p["eliminated_day"] = state["day"]
        state["eliminations"].append({"day": state["day"], "player_id": kill_target_id, "method": "mafia_kill"})

# Advance day
state["day"] += 1
state["phase"] = "day_chat"

# Win check
living_after = [p for p in state["players"] if p["alive"]]
mafia_alive = [p for p in living_after if p["faction"] == "mafia"]
town_alive = [p for p in living_after if p["faction"] == "town"]

if len(mafia_alive) == 0:
    state["winner"] = "town"
    state["phase"] = "finished"
elif len(mafia_alive) >= len(town_alive):
    state["winner"] = "mafia"
    state["phase"] = "finished"
elif state["day"] > 10:
    state["winner"] = "draw"
    state["phase"] = "finished"

# Build summary for next day discussion
parts = [f"Day {state['day']}."]
for e in state["night_log"]:
    if e.get("day") == state["day"] - 1 and e.get("action") == "mafia_kill" and e.get("visibility") == "public":
        tname = pm.get(e["target_id"], {}).get("name", "unknown")
        if e.get("protected"):
            parts.append("Someone was attacked last night but survived!")
        else:
            parts.append(f"{tname} was killed by the Mafia last night.")
for e in state["eliminations"]:
    if e.get("day") == state["day"] - 1 and e.get("method") == "vote":
        ename = pm.get(e["player_id"], {}).get("name", "unknown")
        erole = pm.get(e["player_id"], {}).get("role", "unknown")
        parts.append(f"Yesterday, {ename} was voted out (was {erole}).")

living_names = ", ".join(p["name"] for p in living_after)
parts.append(f"Living: {living_names}.")
state["daySummary"] = " ".join(parts)

print(json.dumps(state))
'''

# ── Game Over summary code ────────────────────────────────────

GAME_OVER_CODE = r'''import json, sys

data = json.load(sys.stdin)
state = data["input"]

pm = {p["id"]: p for p in state["players"]}
winner = state.get("winner", "unknown")

lines = [f"# Mafia Game Over -- {winner.upper()} WINS!\n"]

for day in range(1, state["day"] + 1):
    lines.append(f"\n## Day {day}")
    for e in state.get("eliminations", []):
        if e["day"] == day and e["method"] == "vote":
            p = pm[e["player_id"]]
            lines.append(f"- Voted out: **{p['name']}** (was {p['role']})")
    for e in state.get("night_log", []):
        if e.get("day") == day and e.get("action") == "mafia_kill" and e.get("visibility") == "public":
            t = pm[e["target_id"]]
            if e.get("protected"):
                lines.append(f"- Night: {t['name']} was attacked but **saved** by the Doctor!")
            else:
                lines.append(f"- Night: **{t['name']}** killed by Mafia (was {t['role']})")

lines.append("\n## Final Roster")
for p in state["players"]:
    status = "ALIVE" if p["alive"] else f"eliminated day {p['eliminated_day']}"
    lines.append(f"- {p['name']}: {p['role']} ({p['faction']}) -- {status}")

print("\n".join(lines))
'''

# ── Build workflow ────────────────────────────────────────────

nodes = [
    # Trigger
    {
        "id": "trigger",
        "type": "trigger",
        "position": {"x": 500, "y": 60},
        "data": {"label": "Trigger", "type": "trigger", "config": {"type": "channel"}},
    },
    # Setup
    {
        "id": "setup",
        "type": "transform",
        "position": {"x": 500, "y": 220},
        "data": {"label": "Setup", "type": "transform", "config": {"runtime": "python", "code": SETUP_CODE}},
    },
    # Day Discussion (discussion node)
    {
        "id": "day_discussion",
        "type": "discussion",
        "position": {"x": 500, "y": 420},
        "data": {
            "label": "Day Discussion",
            "type": "discussion",
            "config": {
                "prompt": DISCUSSION_PROMPT,
                "maxRounds": 20,
                "moderator": {
                    "type": "code",
                    "node": {
                        "config": {"runtime": "python", "code": MODERATOR_CODE},
                    },
                },
            },
        },
    },
    # Day Vote
    {
        "id": "day_vote",
        "type": "transform",
        "position": {"x": 500, "y": 680},
        "data": {"label": "Day Vote", "type": "transform", "config": {"runtime": "python", "code": DAY_VOTE_CODE}},
    },
    # Night Phase
    {
        "id": "night_phase",
        "type": "transform",
        "position": {"x": 500, "y": 860},
        "data": {"label": "Night Phase", "type": "transform", "config": {"runtime": "python", "code": NIGHT_CODE}},
    },
    # Game Check
    {
        "id": "game_check",
        "type": "condition",
        "position": {"x": 500, "y": 1060},
        "data": {
            "label": "Game Over?",
            "type": "condition",
            "config": {"expression": "input.winner !== null && input.winner !== undefined"},
        },
    },
    # Game Over (summary)
    {
        "id": "game_over",
        "type": "transform",
        "position": {"x": 300, "y": 1240},
        "data": {"label": "Game Summary", "type": "transform", "config": {"runtime": "python", "code": GAME_OVER_CODE}},
    },
    # Output
    {
        "id": "output",
        "type": "output",
        "position": {"x": 300, "y": 1400},
        "data": {"label": "Output", "type": "output", "config": {"type": "claude-code"}},
    },
    # 9 agent nodes
    *agents,
]

edges = [
    # Main flow
    {"id": "e_trigger_setup", "source": "trigger", "target": "setup"},
    {"id": "e_setup_discuss", "source": "setup", "target": "day_discussion"},
    {"id": "e_discuss_vote", "source": "day_discussion", "target": "day_vote"},
    {"id": "e_vote_night", "source": "day_vote", "target": "night_phase"},
    {"id": "e_night_check", "source": "night_phase", "target": "game_check"},
    {"id": "e_check_over", "source": "game_check", "target": "game_over", "sourceHandle": "true"},
    {"id": "e_check_loop", "source": "game_check", "target": "day_discussion", "sourceHandle": "false"},
    {"id": "e_over_output", "source": "game_over", "target": "output"},
    # Participant edges (agents → discussion)
    *[
        {"id": f"e_{name}_discuss", "source": name, "target": "day_discussion", "targetHandle": "participants"}
        for name in AGENT_NAMES
    ],
]

workflow = {
    "name": "Mafia Game v2",
    "toolName": "mafia_game_v2",
    "description": "9-player Mafia with discussion node for day phase. Town (6) vs Mafia (3).",
    "nodes": nodes,
    "edges": edges,
}

# POST to API
body = json.dumps(workflow).encode()
req = urllib.request.Request(
    f"{API}/api/workflows",
    data=body,
    headers={"Content-Type": "application/json"},
    method="POST",
)

try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
    print(f"Created workflow: id={result['id']}, name={result['name']}")
    print(f"  Nodes: {len(nodes)}, Edges: {len(edges)}")
    print(f"  URL: http://localhost:5173/workflows/{result['id']}")
except urllib.error.HTTPError as e:
    print(f"ERROR {e.code}: {e.read().decode()}")
