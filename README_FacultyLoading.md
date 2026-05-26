# Faculty Loading — How It Works

This document explains how the system automatically assigns faculty members to subject offerings each semester. The goal is a fair, well-matched, and balanced faculty loading — produced with as little manual work as possible.

---

## Overview

```
Subject Offerings + Faculty Records
             │
             ▼
      Pre-Flight Check
    (filter out subjects)
             │
             ▼
    ┌─────────────────────────┐
    │   Layered Filtering     │
    │  (Assignment Planning)  │
    │                         │
    │  Layer 1 → Preference   │
    │  Layer 2 → Specialization│
    │  Layer 3 → Department   │
    │  Layer 4 → Cross-Dept   │
    └─────────────────────────┘
             │
             ▼
    Genetic Algorithm (GA)
    (Optimization & Refinement)
             │
             ▼
    Generated Faculty Loading
      (Displayed in the UI)
```

---

## Step 1 — Pre-Flight Check

Before any assignment begins, the system performs a quick scan of all subject offerings. Subjects that do not meet the minimum requirements for processing — such as missing schedule details or incomplete records — are flagged and removed from the main flow. This keeps the assignment process clean and error-free from the start.

---

## Step 2 — Layered Filtering System

All remaining subjects go through a **multi-layer filtering system**, processed one by one from top to bottom. Each layer tries to find the best available faculty for a subject. If a match is found, the subject is assigned and moves on. If not, it falls down to the next layer.

---

### Layer 1 — Faculty Preference (Tagging)

> *"This faculty member volunteered for this subject."*

Faculty members can tag subjects they prefer or are willing to handle. When a subject reaches this layer, the system looks for all faculty who have tagged it.

If multiple faculty tagged the same subject, they compete based on a scoring system:

| Factor | Description |
|---|---|
| Priority Level | Was this subject marked as high priority by the faculty? |
| Same Department | Does the faculty belong to the same department as the subject? |
| Faculty Role | Is the faculty a full-time, part-time, or special lecturer? |
| Current Workload | Does this faculty have fewer assigned units than others? |

The faculty member with the **highest combined score** gets assigned to the subject. Think of it as a friendly competition — preference alone is not enough; fit and availability matter too.

---

### Layer 2 — Faculty Specialization (Keyword Matching)

> *"This subject falls within this faculty's area of expertise."*

If no faculty tagged a subject, the system checks each faculty member's listed specializations. It looks for **keyword matches** between the faculty's specialization fields and the subject's descriptive title.

The more keywords that match, the higher the faculty's score. From there, the same tiebreaker factors apply:

| Factor | Description |
|---|---|
| Match Score | How many keywords from the faculty's specialization match the subject title? |
| Same Department | Does the faculty belong to the same department as the subject? |
| Faculty Role | Full-time, part-time, or special lecturer? |
| Current Workload | Fewer assigned units is better. |

Again, the faculty with the **highest combined score** is assigned.

---

### Layer 3 — Same Department

> *"No direct match found — let's look within the same department."*

If no specialization match is found, the system falls back to faculty from the **same department** as the subject. While there is no keyword matching here, the scoring still ensures fair selection:

| Factor | Description |
|---|---|
| Faculty Role | Full-time, part-time, or special lecturer? |
| Current Workload | Fewer assigned units is better. |

The faculty with the **highest combined score** within the department is assigned.

---

### Layer 4 — Cross-Department Assignment *(IT → CS only)*

> *"A special case: IT faculty can cover CS subjects."*

At this time, the CS (Computer Science) department has no active faculty of its own. As a practical solution, IT (Information Technology) faculty are allowed to handle CS subjects, since their fields are closely related.

This cross-department assignment **only applies from IT to CS**. No other department-to-department crossover is allowed.

---

### Unassigned Subjects — Issues Report

If a subject passes through all four layers and still cannot be assigned — because no faculty is available or all faculty have already reached their maximum unit load — it is **not silently skipped**. Instead, it is recorded in an **Issues Report**, which notifies the administrator of every subject that could not be assigned and the reason why.

---

## Step 3 — Genetic Algorithm (GA) Optimization

Once the initial assignment plan is ready, the system runs it through a **Genetic Algorithm** to improve the overall result.

Here is the idea in plain terms:

> The system creates **120 slightly different versions** of the assignment plan. It then evaluates each version, picks the best ones, combines their strengths, and discards the weaker ones. This process repeats — just like natural selection — until the plan reaches its best possible state.

Each cycle is called a **generation**. The GA continues until one of these conditions is met:

- **120 generations** have been completed, or
- The plan has **not improved for 20 generations in a row**, or
- **120 seconds** have passed (time limit)

The result is a faculty loading plan that is as fair, balanced, and well-matched as the available data allows.

---

## Step 4 — Output

Once the GA finishes, the system displays the **Generated Faculty Loading List** in the interface. This list shows every subject offering with its assigned faculty member, ready for review, adjustment, or finalization.

---

## Summary

| Step | What Happens |
|---|---|
| Pre-Flight Check | Invalid or incomplete subjects are filtered out |
| Layer 1 — Preference | Faculty who tagged the subject compete by score |
| Layer 2 — Specialization | Faculty with matching expertise compete by score |
| Layer 3 — Department | Faculty from the same department compete by score |
| Layer 4 — Cross-Dept | IT faculty cover CS subjects (special case only) |
| Issues Report | Unassigned subjects are flagged for review |
| GA Optimization | The plan is refined across up to 120 generations |
| Output | Final faculty loading list is shown in the UI |
