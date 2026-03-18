"""Domain analytics functions implemented in Python."""

from __future__ import annotations

from datetime import date

from atlas_platform.models import Activity, ActivityStatus
from atlas_platform.schemas import PortfolioMetrics


def _is_delayed(activity: Activity, reference_day: date) -> bool:
    if activity.status == ActivityStatus.delayed:
        return True
    if activity.status == ActivityStatus.completed:
        return False
    return activity.planned_end_date is not None and activity.planned_end_date < reference_day


def _is_blocked(activity: Activity, by_code: dict[str, Activity]) -> bool:
    if activity.status == ActivityStatus.blocked:
        return True
    if not activity.dependencies:
        return False
    for dependency_code in activity.dependencies:
        parent = by_code.get(dependency_code)
        if parent and parent.status != ActivityStatus.completed:
            return True
    return False


def compute_portfolio_metrics(activities: list[Activity], reference_day: date | None = None) -> PortfolioMetrics:
    """Compute dashboard-level portfolio metrics."""

    today = reference_day or date.today()
    total = len(activities)
    if total == 0:
        return PortfolioMetrics(
            total_activities=0,
            delayed_activities=0,
            high_risk_activities=0,
            completed_activities=0,
            blocked_activities=0,
            average_completion=0.0,
        )

    by_code = {activity.activity_code: activity for activity in activities}
    delayed = sum(1 for activity in activities if _is_delayed(activity, today))
    high_risk = sum(1 for activity in activities if activity.risk_score >= 55)
    completed = sum(1 for activity in activities if activity.status == ActivityStatus.completed)
    blocked = sum(1 for activity in activities if _is_blocked(activity, by_code))
    avg_completion = round(sum(activity.completion_percentage for activity in activities) / total, 2)

    return PortfolioMetrics(
        total_activities=total,
        delayed_activities=delayed,
        high_risk_activities=high_risk,
        completed_activities=completed,
        blocked_activities=blocked,
        average_completion=avg_completion,
    )
