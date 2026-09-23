/**
 * The agent's own to-do list, live.
 *
 * GG Coder (and other ACP agents) plan a job as a checklist and ticks entries
 * off while it works — visible on the desktop, and until now invisible here:
 * the phone only ever showed one line naming the current tool, which reads as
 * "still going?" for what can be minutes of multi-step work. This is the rest
 * of that picture: every step, and which one it is on.
 *
 * Deliberately plain, matching `TurnReceipt`'s register rather than
 * `ActivityLine`'s motion — a checklist is read, not watched. It sits above
 * the footer's activity/receipt row in `ChatThread.tsx` and, unlike that row,
 * survives the turn ending: the plan is the agent's task list for the whole
 * conversation, not one exchange, so it stays up until GG Coder replaces or
 * clears it.
 */
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { theme } from "../theme";
import { planComplete, planProgress, type PlanStep } from "../plan";
import { STATUS_ROW_MAX_FONT_SCALE } from "./statusRow";

const GLYPH: Record<PlanStep["status"], keyof typeof Ionicons.glyphMap> = {
  pending: "ellipse-outline",
  in_progress: "ellipse",
  completed: "checkmark-circle",
};

const COLOR: Record<PlanStep["status"], string> = {
  pending: theme.color.textFaint,
  in_progress: theme.color.accent,
  completed: theme.color.success,
};

function stepRowKey(index: number, step: PlanStep): string {
  return String(index) + ":" + step.content;
}

function PlanChecklistView({ steps }: { steps: PlanStep[] }) {
  if (steps.length === 0) return null;
  const { done, total } = planProgress(steps);
  const complete = planComplete(steps);

  return (
    <View
      style={[styles.card, complete && styles.cardComplete]}
      accessible
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      accessibilityLabel={
        complete
          ? "Task list complete"
          : `Task list, ${done} of ${total} done. ${steps
              .map((step) => `${step.content}: ${step.status.replace("_", " ")}`)
              .join(". ")}`
      }
    >
      <Text style={styles.heading} maxFontSizeMultiplier={STATUS_ROW_MAX_FONT_SCALE}>
        {done} of {total}
      </Text>
      {steps.map((step, index) => {
        const rowKey = stepRowKey(index, step);
        return (
          <View key={rowKey} style={styles.row}>
            <Ionicons name={GLYPH[step.status]} size={14} color={COLOR[step.status]} style={styles.icon} />
            <Text
              style={[
                styles.text,
                step.status === "completed" && styles.textDone,
                step.status === "in_progress" && styles.textActive,
              ]}
              numberOfLines={2}
              maxFontSizeMultiplier={STATUS_ROW_MAX_FONT_SCALE}
            >
              {step.content}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: theme.space(5),
    marginHorizontal: theme.gutter,
    paddingVertical: theme.space(3),
    paddingHorizontal: theme.space(4),
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceRaised,
    gap: theme.space(1.5),
  },
  cardComplete: {
    opacity: 0.6,
  },
  heading: {
    fontSize: theme.font.tiny,
    fontWeight: "600",
    color: theme.color.textFaint,
    marginBottom: theme.space(1),
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space(2),
  },
  icon: { marginTop: 2 },
  text: {
    flex: 1,
    fontSize: theme.font.small,
    lineHeight: theme.line.body,
    color: theme.color.textDim,
  },
  textDone: {
    color: theme.color.textFaint,
    textDecorationLine: "line-through",
  },
  textActive: {
    color: theme.color.text,
    fontWeight: "500",
  },
});

export const PlanChecklist = memo(PlanChecklistView);
