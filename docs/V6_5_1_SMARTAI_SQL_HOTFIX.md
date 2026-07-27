# FactoryBox One v6.5.1 SmartAI SQL Hotfix

## Problem

SmartAI report generation could return:

```text
syntax error at or near "AS"
```

The error was caused by a dense PostgreSQL aggregation expression used for alarm KPI collection.

## Fix

- Replaced compact `FILTER`/cast expressions with explicit `SUM(CASE WHEN ...)` aggregations.
- Rewrote acknowledgement and resolution averages with explicit `CASE` expressions.
- Rewrote alarm type and machine aggregation queries using unambiguous aliases and grouping.
- Updated backend and Admin Panel version to v6.5.1.

## Test

Open SmartAI > AI Reports and generate a daily or weekly report with the FactoryBox Rule Engine.
