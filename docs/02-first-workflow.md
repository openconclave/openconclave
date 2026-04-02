# Create Your First Workflow

In this 5-minute tutorial, you'll create a simple workflow that uses an AI agent to generate ideas.

## What You'll Build

A workflow that:
1. Starts with a manual trigger
2. Asks an AI agent to generate creative ideas on a topic
3. Outputs the ideas to your terminal

**Estimated time:** 5 minutes
**Difficulty:** Beginner
**Prerequisites:** OpenConclave installed with at least one AI provider configured

## Step-by-Step

### 1. Create a New Workflow

Open OpenConclave at http://localhost:5173

Click **Workflows** in the left sidebar, then click **+ New Workflow**

![Workflows Page](../02-workflows.png)

A dialog will appear asking for the workflow name.

Enter: **Idea Generator**

Click **Create**

### 2. Open the Workflow Editor

The workflow editor will open with a blank canvas.

![Workflow Editor](../03-workflow-editor.png)

You'll see:
- **Left panel:** Node types (Trigger, Agent, Condition, Code, etc.)
- **Center canvas:** Where you build your workflow
- **Right panel:** Inspector (properties for selected nodes)

### 3. Add a Trigger Node

1. Click **Trigger** in the left panel
2. Click on the canvas to place it
3. A green pill-shaped node appears labeled "Trigger"

In the inspector (right panel):
- **Type:** Leave as "manual" (click to run manually)
- **Label:** Keep as "Trigger"

### 4. Add an Agent Node

1. Click **Agent** in the left panel
2. Click on the canvas to the right of the Trigger node
3. A blue rectangular node labeled "Agent" appears

In the inspector:
- **Label:** Change to **"Generate Ideas"**
- **Engine:** Select "Claude" (or your configured AI provider)
- **Model:** Select a model (e.g., "claude-3-haiku")
- **Prompt:** Enter this prompt:

```
Generate 5 creative ideas for a ${topic}.
Be specific and actionable.
Format as a numbered list.
```

### 5. Connect Trigger to Agent

Click the **circular handle** on the right side of the Trigger node and drag to the Agent node.

A blue arrow will connect them.

### 6. Add an Output Node

1. Click **Output** in the left panel
2. Place it to the right of the Agent node
3. A red pill-shaped node appears labeled "Output"

In the inspector:
- **Label:** Change to **"Show Results"**
- **Type:** Select "log" (will show in the run details)
- **Content:** Leave as default or customize

### 7. Connect Agent to Output

Click the circular handle on the Agent node's right side and drag to the Output node.

Your workflow now looks like: **Trigger → Generate Ideas → Show Results**

### 8. Test Your Workflow (Optional Input)

If your Agent node needs input:
1. Click the Agent node
2. In the inspector, check if the prompt uses **${variableName}**
3. You might need to add a way to input the topic

Let's add input - click the **Trigger** node:
- Add a **Prompt** field: "What topic would you like ideas for?"

This will ask you for input when you run the workflow.

### 9. Save the Workflow

Click **Save** button (top right)

You should see: "Workflow saved successfully"

### 10. Run the Workflow

Click **Run** button (green, top right)

The workflow will execute:
1. Trigger prompts you for a topic (if configured)
2. Agent generates ideas
3. Output shows results

### 11. Check the Results

Go to **Runs** page to see your workflow execution.

Click on the run to see:
- **Agent Tasks:** The prompt and response
- **Events Timeline:** Step-by-step execution
- **Cost:** API costs if using paid provider
- **Duration:** How long it took

![Run Detail](../05-run-detail.png)

## Congratulations! 🎉

You've created your first workflow! It demonstrates:
- ✅ Creating a workflow
- ✅ Adding different node types
- ✅ Connecting nodes
- ✅ Running and monitoring execution
- ✅ Viewing results

## Next: Add More Features

### Make It More Interesting

**Try these enhancements:**

1. **Add a Code node** before the Agent to validate input
2. **Add a Condition node** to check if ideas are relevant
3. **Run it on a schedule** using the Trigger's Cron option
4. **Send to Telegram** instead of just logging
5. **Search your knowledge base** for context

### Add a Knowledge Base

1. Go to **Knowledge** page
2. Create a new knowledge base
3. Upload documents relevant to your topic
4. In the Agent node inspector, attach the knowledge base
5. The agent can now search for context before generating ideas

### Schedule It

1. Edit the **Trigger** node
2. Change type from "manual" to "cron"
3. Select a schedule (e.g., "Daily at 9am")
4. Save and activate

The workflow will now run automatically!

### Add Conditional Logic

1. Add a **Condition** node after the Agent
2. Set a JavaScript expression like: `result.length > 100`
3. Route success to Output, failure to a different node
4. Create branching logic based on agent output

## Workflow Patterns

Now that you understand the basics, explore these patterns:

- **Sequential:** Task1 → Task2 → Task3
- **Parallel:** Start → [Task1, Task2, Task3] → Merge → End
- **Looping:** Agent → Condition → (back to Agent if failed)
- **Dynamic Routing:** Agent decides next step via tool call
- **Channel-in-the-Loop:** Agent asks you a question mid-workflow

See [Common Patterns Guide](10-patterns.md) for more examples.

## Troubleshooting

### Workflow won't run
- Check that an AI provider is configured in Settings
- Verify the model name is correct
- Check that the prompt syntax is valid

### Agent returns an error
- Click the run to see the error details
- Check the prompt for undefined variables
- Verify the AI provider's API key is valid

### Can't save workflow
- Check for duplicate workflow names
- Verify the canvas has at least a Trigger and Output node
- Try refreshing the page

## Learn More

- 📖 [Workflow Editor Guide](04-workflow-editor.md) — Advanced editor features
- 📋 [Node Types Reference](05-node-types.md) — All 9 node types explained
- 💡 [Common Patterns](10-patterns.md) — Sequential, parallel, loops
- 🎯 [Use Cases](11-use-cases.md) — Real-world workflow examples

---

**Next:** [Explore the Workflow Editor →](04-workflow-editor.md)
