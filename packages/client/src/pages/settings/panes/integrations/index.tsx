import { Section, FieldRow, SecretInput } from "../../atoms";

export function IntegrationsPane({
  values,
  setValue,
}: {
  values: Record<string, string>;
  setValue: (k: string, v: string) => void;
}) {
  return (
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <h1>Integrations</h1>
          <p>Trigger conclaves from external events. Each integration unlocks matching Trigger nodes in the editor.</p>
        </div>
      </div>

      <Section title="Telegram" sub="Bot messages as trigger input">
        <FieldRow label="Bot token" help="Get a token from @BotFather. Required for Telegram triggers.">
          <SecretInput
            value={values.telegram_bot_token ?? ""}
            placeholder="123456:ABC-DEF..."
            onChange={(v) => setValue("telegram_bot_token", v)}
          />
        </FieldRow>
      </Section>

      <Section title="Incoming webhooks" sub="HTTP endpoints that start runs">
        <div className="settings-info">
          Webhooks are created per-conclave via the <code>Trigger</code> node in the editor. The URL is shown on the node once saved.
        </div>
      </Section>

      <Section title="Schedules" sub="Cron-driven runs">
        <div className="settings-info">
          Add a <code>Trigger</code> node and choose <em>Schedule</em> to run a conclave on a cron expression.
        </div>
      </Section>
    </div>
  );
}
