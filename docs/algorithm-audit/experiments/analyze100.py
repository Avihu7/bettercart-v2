"""EXPERIMENT ONLY. Summarises results-100.json -> summary-100.json (and prints it).
   python3 analyze100.py            (no arguments; reads the files next to it)"""
import json, statistics as st, os
here = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(os.path.join(here, "results-100.json")))
sc = d["scenarios"]
def chosen_gain(s):
    e = s["extended"]
    if "search" not in e: return None
    v = next((x for x in e["search"] if x["variant"] == e.get("chosenVariant")), None)
    return v.get("gain") if v else None
def any_gain(s):
    e = s["extended"]
    return max((x.get("gain") or 0) for x in e.get("search", [])) if "search" in e else None
def cls(o):
    return "improved" if o.startswith("improved") else "regressed" if o.startswith("regressed") else "identical" if o == "identical menu" else "same_rank"
rows = []
for s in sc:
    b, e = s["baseline"], s["extended"]
    rows.append({"id": s["id"], "kind": s.get("kind"), "design": s.get("design"), "outcome": cls(s["outcome"]), "decidedBy": s.get("decidedBy"),
        "extendedRefused": "error" in e,
        # an algorithm that cannot produce an acceptable menu is counted as level 4 (refused) and not hard-valid
        "levelBase": b.get("validator", {}).get("level", 4), "levelExt": e.get("validator", {}).get("level", 4),
        "hardBase": bool(b.get("structure", {}).get("hardValid")), "hardExt": bool(e.get("structure", {}).get("hardValid")),
        "gainChosen": chosen_gain(s), "gainMax": any_gain(s), "replica": s["replicaEqualsProduction"],
        "msBase": s["timing"]["baseline"]["fullPipelineMs"]["median"] if s["timing"]["baseline"] else None,
        "msExt": s["timing"]["extended"]["fullPipelineMs"]["median"] if s["timing"]["extended"] else None,
        "plannerBase": s["timing"]["baseline"]["plannerOnlyMs"]["median"] if s["timing"]["baseline"] else None,
        "plannerExt": s["timing"]["extended"]["plannerOnlyMs"]["median"] if s["timing"]["extended"] else None,
        "deterministic": bool(s["timing"]["baseline"] and s["timing"]["baseline"]["samePlanInEveryRun"] and s["timing"]["extended"]["samePlanInEveryRun"] and s["timing"]["baseline"]["sameAsQualityRun"] and s["timing"]["extended"]["sameAsQualityRun"]),
        "budgetBase": b.get("budget", {}).get("cost"), "budgetExt": e.get("budget", {}).get("cost", float("inf")), "budget": s["input"]["weeklyFoodBudget"],
        "products": s["input"]["products"]})
def count(rs, f): return sum(1 for r in rs if f(r))
def block(rs):
    n = len(rs)
    out = {"scenarios": n, "improved": count(rs, lambda r: r["outcome"] == "improved"), "regressed": count(rs, lambda r: r["outcome"] == "regressed"),
        "identicalMenu": count(rs, lambda r: r["outcome"] == "identical"), "differentMenuSameRank": count(rs, lambda r: r["outcome"] == "same_rank"),
        "objectiveHigherInChosenVariant": count(rs, lambda r: (r["gainChosen"] or 0) > 1e-9), "objectiveLowerInChosenVariant": count(rs, lambda r: (r["gainChosen"] or 0) < -1e-9),
        "objectiveHigherInAnyVariant": count(rs, lambda r: (r["gainMax"] or 0) > 1e-9),
        "levelBetter": count(rs, lambda r: r["levelExt"] < r["levelBase"]), "levelWorse": count(rs, lambda r: r["levelExt"] > r["levelBase"]),
        "hardValidBaseline": count(rs, lambda r: r["hardBase"]), "hardValidExtended": count(rs, lambda r: r["hardExt"]),
        "deterministic": count(rs, lambda r: r["deterministic"]), "replicaEqualsProduction": count(rs, lambda r: r["replica"]),
        "overBudgetBaseline": count(rs, lambda r: r["budgetBase"] > r["budget"] + 0.005), "overBudgetExtended": count(rs, lambda r: r["budgetExt"] != float("inf") and r["budgetExt"] > r["budget"] + 0.005), "extendedRefused": count(rs, lambda r: r["extendedRefused"]),
        "baselineLevels": {str(l): count(rs, lambda r: r["levelBase"] == l) for l in (1, 2, 3, 4)}, "extendedLevels": {str(l): count(rs, lambda r: r["levelExt"] == l) for l in (1, 2, 3, 4)}}
    mb, me = [r["msBase"] for r in rs], [r["msExt"] for r in rs]
    pb, pe = [r["plannerBase"] for r in rs], [r["plannerExt"] for r in rs]
    out["fullPipelineMs"] = {"baselineMedian": round(st.median(mb), 1), "extendedMedian": round(st.median(me), 1), "overheadPct": round((st.median(me) - st.median(mb)) / st.median(mb) * 100, 1),
        "baselineMean": round(st.mean(mb), 1), "extendedMean": round(st.mean(me), 1), "baselineMax": max(mb), "extendedMax": max(me),
        "medianOfPerScenarioRatio": round(st.median([e / b for b, e in zip(mb, me)]), 2)}
    out["plannerOnlyMs"] = {"baselineMedian": round(st.median(pb), 1), "extendedMedian": round(st.median(pe), 1), "overheadPct": round((st.median(pe) - st.median(pb)) / st.median(pb) * 100, 1)}
    g = [r["gainChosen"] or 0 for r in rs]
    out["objectiveGainChosen"] = {"median": round(st.median(g), 3), "mean": round(st.mean(g), 3), "max": round(max(g), 3)}
    reg = [r for r in rs if r["outcome"] == "regressed"]; imp = [r for r in rs if r["outcome"] == "improved"]
    out["decidedByAmongRegressed"] = {k: count(reg, lambda r: r["decidedBy"] == k) for k in sorted({r["decidedBy"] for r in reg if r["decidedBy"]})}
    out["decidedByAmongImproved"] = {k: count(imp, lambda r: r["decidedBy"] == k) for k in sorted({r["decidedBy"] for r in imp if r["decidedBy"]})}
    out["regressedWithHigherObjective"] = count(reg, lambda r: (r["gainChosen"] or 0) > 1e-9)
    return out
summary = {"source": "results-100.json", "generated": d["generated"], "baselineCommit": d["baselineCommit"], "timingRuns": d["timingRuns"], "environment": d["environment"],
    "productionUnchangedDuringRun": d["productionUnchangedDuringRun"],
    "all": block(rows), "original10": block([r for r in rows if r["kind"] == "original"]), "synthetic90": block([r for r in rows if r["kind"] == "synthetic"]),
    "bySize": {k: {x: count([r for r in rows if r["design"] and r["design"]["size"] == k], lambda r: r["outcome"] == x) for x in ("improved", "regressed", "identical", "same_rank")} for k in ("sparse", "medium", "rich")},
    "byBudget": {k: {x: count([r for r in rows if r["design"] and r["design"]["budget"] == k], lambda r: r["outcome"] == x) for x in ("improved", "regressed", "identical", "same_rank")} for k in ("tight", "normal", "generous")},
    "rows": rows}
for r in rows:
    if r["budgetExt"] == float("inf"): r["budgetExt"] = None
json.dump(summary, open(os.path.join(here, "summary-100.json"), "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in summary.items() if k != "rows"}, ensure_ascii=False, indent=1))
