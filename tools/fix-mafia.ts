const CONCLAVE_ID = 40;
const BASE = process.env.OC_API_URL ?? "http://localhost:4000";

const DAY_VOTE = String.raw`import json, sys, os, random, urllib.request
from collections import Counter

data = json.load(sys.stdin)
disc = data["input"]
state = disc["input"]
transcript = disc.get("transcript", "")

api_url = os.environ["OC_API_URL"]
conclave_id = os.environ["OC_CONCLAVE_ID"]
run_id = os.environ["OC_RUN_ID"]

def call_agent(node_id, prompt, tools=None):
    body = {"conclaveId": int(conclave_id), "runId": int(run_id), "nodeId": node_id, "prompt": prompt}
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

counts = Counter(v["target"] for v in day_votes)
top = counts.most_common(2)

if len(top) >= 2 and top[0][1] == top[1][1]:
    pass  # tie: nobody eliminated
else:
    elim_id = top[0][0]
    for p in state["players"]:
        if p["id"] == elim_id:
            p["alive"] = False
            p["eliminated_day"] = state["day"]
    state["eliminations"].append({"day": state["day"], "player_id": elim_id, "method": "vote"})

state["chat_log"].append({"day": state["day"], "transcript": transcript})

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
`;

const NIGHT_PHASE = String.raw`import json, sys, os, random, urllib.request
from collections import Counter

data = json.load(sys.stdin)
state = data["input"]

if state.get("winner"):
    print(json.dumps(state))
    sys.exit(0)

api_url = os.environ["OC_API_URL"]
conclave_id = os.environ["OC_CONCLAVE_ID"]
run_id = os.environ["OC_RUN_ID"]

def call_agent(node_id, prompt, tools=None):
    body = {"conclaveId": int(conclave_id), "runId": int(run_id), "nodeId": node_id, "prompt": prompt}
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

state["day"] += 1
state["phase"] = "day_chat"

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
`;

const GAME_OVER = String.raw`import json, sys
from collections import Counter

data = json.load(sys.stdin)
state = data["input"]

pm = {p["id"]: p for p in state["players"]}
winner = state.get("winner", "unknown")
total_days = max(state.get("day", 1) - 1, 1)

FACTION_EMOJI = {"mafia": "🩸", "town": "🏛️"}
ROLE_EMOJI = {
    "godfather": "👑", "mafia": "🗡️",
    "detective": "🔍", "doctor": "🩺",
    "townsperson": "🧑‍🌾",
}
WINNER_BANNER = {
    "town": "🏛️  **TOWN PREVAILS**  🏛️",
    "mafia": "🩸  **MAFIA TAKES THE NIGHT**  🩸",
    "draw": "⚖️  **STALEMATE**  ⚖️",
    "unknown": "❓  **NO WINNER**  ❓",
}
WINNER_TAG = {
    "town": "The townsfolk unmasked every traitor.",
    "mafia": "The syndicate outlasted the village.",
    "draw": "Ten days of paranoia and still no conclusion.",
    "unknown": "The story ends mid-sentence.",
}

lines = []
lines.append("# 🎭 Mafia: A Conclave of Nine")
lines.append("")
lines.append(f"> *{total_days}-day conclave · 9 agents · orchestrated by OpenConclave*")
lines.append("")
lines.append("---")
lines.append("")
lines.append(f"## {WINNER_BANNER.get(winner, WINNER_BANNER['unknown'])}")
lines.append("")
lines.append(f"*{WINNER_TAG.get(winner, WINNER_TAG['unknown'])}*")
lines.append("")

mafia_roster = [p for p in state["players"] if p["faction"] == "mafia"]
town_roster = [p for p in state["players"] if p["faction"] == "town"]
lines.append("### Dramatis Personae")
lines.append("")
lines.append("| Faction | Players |")
lines.append("|---|---|")
lines.append(f"| 🩸 Mafia ({len(mafia_roster)}) | " + ", ".join(f"{ROLE_EMOJI.get(p['role'], '•')} **{p['name']}** *({p['role']})*" for p in mafia_roster) + " |")
lines.append(f"| 🏛️ Town ({len(town_roster)}) | " + ", ".join(f"{ROLE_EMOJI.get(p['role'], '•')} **{p['name']}** *({p['role']})*" for p in town_roster) + " |")
lines.append("")

lines.append("---")
lines.append("")
lines.append("## Act-by-Act")
lines.append("")

for day in range(1, total_days + 1):
    lines.append(f"### ☀️ Day {day}")
    lines.append("")

    day_votes = [v for v in state.get("votes", []) if v["day"] == day]
    vote_elim = next((e for e in state.get("eliminations", []) if e["day"] == day and e["method"] == "vote"), None)

    if day_votes:
        tally = Counter(v["target_id"] for v in day_votes)
        lines.append("**Vote tally**")
        lines.append("")
        lines.append("| Accused | Votes | From |")
        lines.append("|---|---|---|")
        for target_id, count in tally.most_common():
            voters = [pm[v["voter_id"]]["name"] for v in day_votes if v["target_id"] == target_id]
            target = pm.get(target_id, {"name": "unknown"})
            marker = " ⚰️" if vote_elim and vote_elim["player_id"] == target_id else ""
            bar = "█" * count
            lines.append(f"| **{target['name']}**{marker} | \`{bar}\` {count} | {', '.join(voters)} |")
        lines.append("")

    if vote_elim:
        p = pm[vote_elim["player_id"]]
        lines.append(f"> ⚰️  The village sent **{p['name']}** to the gallows. They were a *{p['role']}* of the **{p['faction']}**.")
        lines.append("")
    elif day_votes:
        lines.append("> 🤷  A tie — no one hanged today.")
        lines.append("")

    lines.append(f"### 🌙 Night {day}")
    lines.append("")

    night_events = [e for e in state.get("night_log", []) if e.get("day") == day]
    mafia_msgs = [e for e in night_events if e.get("action") == "mafia_chat"]
    invs = [e for e in night_events if e.get("action") == "investigate"]
    prots = [e for e in night_events if e.get("action") == "protect"]
    kills = [e for e in night_events if e.get("action") == "mafia_kill"]

    if mafia_msgs:
        lines.append("<details><summary>🩸 <b>Mafia war council</b></summary>")
        lines.append("")
        for e in mafia_msgs:
            speaker = pm.get(e["player_id"], {}).get("name", "?")
            content = (e.get("content") or "").strip().replace("\n", " ")
            lines.append(f"- **{speaker}:** {content}")
        lines.append("")
        lines.append("</details>")
        lines.append("")

    if invs:
        for e in invs:
            who = pm.get(e["player_id"], {}).get("name", "?")
            target = pm.get(e["target_id"], {}).get("name", "?")
            verdict = "😇 INNOCENT" if e.get("result") == "innocent" else "😈 GUILTY"
            lines.append(f"- 🔍  **{who}** investigated **{target}** → {verdict}")

    if prots:
        for e in prots:
            who = pm.get(e["player_id"], {}).get("name", "?")
            target = pm.get(e["target_id"], {}).get("name", "?")
            lines.append(f"- 🩺  **{who}** stood watch over **{target}**")

    for e in kills:
        target = pm.get(e["target_id"], {}).get("name", "?")
        if e.get("protected"):
            lines.append(f"- 🛡️  The Mafia came for **{target}** — the Doctor saved them!")
        else:
            role = pm.get(e["target_id"], {}).get("role", "?")
            lines.append(f"- 🗡️  The Mafia slew **{target}** in their sleep *({role})*")

    if not (night_events):
        lines.append("- *(a quiet night)*")
    lines.append("")

lines.append("---")
lines.append("")
lines.append("## 🏁 Final Curtain")
lines.append("")
lines.append("| Player | Role | Faction | Fate |")
lines.append("|---|---|---|---|")
for p in state["players"]:
    if p["alive"]:
        fate = "✨ **Survivor**"
    elif p.get("eliminated_day") is not None:
        fate = f"⚰️ eliminated Day {p['eliminated_day']}"
    else:
        fate = "—"
    role_mark = f"{ROLE_EMOJI.get(p['role'], '•')} {p['role']}"
    faction_mark = f"{FACTION_EMOJI.get(p['faction'], '')} {p['faction']}"
    lines.append(f"| **{p['name']}** | {role_mark} | {faction_mark} | {fate} |")
lines.append("")

lines.append("---")
lines.append("")
lines.append("## 📊 Conclave Stats")
lines.append("")

vote_count = len(state.get("votes", []))
hangings = sum(1 for e in state.get("eliminations", []) if e["method"] == "vote")
kills = sum(1 for e in state.get("eliminations", []) if e["method"] == "mafia_kill")
saves = sum(1 for e in state.get("night_log", []) if e.get("action") == "mafia_kill" and e.get("protected"))
investigations = sum(1 for e in state.get("night_log", []) if e.get("action") == "investigate")

lines.append(f"- **Days played:** {total_days}")
lines.append(f"- **Ballots cast:** {vote_count}")
lines.append(f"- **Hangings:** {hangings}")
lines.append(f"- **Successful hits:** {kills}")
lines.append(f"- **Doctor saves:** {saves}")
lines.append(f"- **Detective investigations:** {investigations}")
lines.append("")
lines.append("---")
lines.append("")
lines.append("*Powered by **OpenConclave** — 9 agents · 1 discussion node · 1 moderator · loop-until-victory.*")

print("\n".join(lines))
`;

async function updateNode(nodeId: string, code: string) {
  const res = await fetch(\`\${BASE}/api/conclaves/\${CONCLAVE_ID}/nodes/\${nodeId}\`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: { runtime: "python", code } }),
  });
  console.log(\`[\${nodeId}] \${res.status} \${await res.text()}\`);
}

await updateNode("day_vote", DAY_VOTE);
await updateNode("night_phase", NIGHT_PHASE);
await updateNode("game_over", GAME_OVER);
