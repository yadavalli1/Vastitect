# Prompt: test the Vastitecture AI assistant

Copy everything below the line into an AI agent that can see and control the screen (for example
Claude with computer use), or hand it to a human tester. Fill in the `<…>` placeholders first.

---

You are testing the **Assistant** page of **Vastitecture**, a desktop app for software architecture
modelling. The assistant is optional and off by default. It talks to an OpenAI-compatible endpoint and
must never change the model without showing a reviewable diff first. Your job is to find bugs and broken
promises, not to praise the app.

**Setup**
- The app is installed at `<path or "Applications › Vastitecture">`.
- The endpoint to use is `<one of the options below>`:
  - **Local (no key):** Ollama running on this Mac. In Terminal: `ollama pull llama3.1`, then make sure
    `ollama serve` is running. Base URL `http://localhost:11434/v1`, model `llama3.1`.
  - **Hosted:** base URL `<https://api.openai.com/v1 or another OpenAI-compatible URL>`, model
    `<model name>`. I will type the API key into the app myself when you reach that step; never ask me
    to paste it into chat and never write it anywhere else.
- Create an empty folder `~/vastitecture-ai-test`.

**Rules**
- Take a screenshot at every step marked 📸 and whenever something looks wrong.
- For every assistant answer, judge quality as well as whether it worked: is it relevant to the
  model, correct, and specific?
- If a step fails, note the exact error text, try once more, then move on.

## 1. Off by default
1. Launch the app. **New workspace** › **Sample: online shop in every notation** › **Create in a
   folder…** › `~/vastitecture-ai-test`.
2. Open **Assistant** in the sidebar. It must say **The AI assistant is off.** 📸
3. Check that **Draft**, **Suggest missing relationships**, **Explain this view** and **Review against
   the validation rules** are disabled.
4. Pick the view **Online Shop – containers** and press **Translate into an ArchiMate view**. This one
   must work with the assistant off and open a review dialog. Press **Discard**.

## 2. Switch it on
1. Press **Set it up in Settings**. Tick **Enable the assistant**, enter the base URL and model.
2. If you use a hosted endpoint, stop and let me type the key into **API key**, then press **Save key**.
   Confirm the page now says a key is stored and the field doesn't show it. 📸
3. Back on **Assistant**, the footer must show the endpoint and model you set.
4. Privacy check: search `~/vastitecture-ai-test` for the key or the word `apiKey`
   (`grep -ri apikey ~/vastitecture-ai-test`). Nothing should be found.

## 3. Draft a model from a description
1. Paste this into **Description or document**, choose **C4** as the notation, press **Draft**:

   > A food delivery platform. Customers order from a mobile app, which calls an API gateway. The
   > gateway routes to an Order service and a Restaurant service. The Order service stores orders in
   > PostgreSQL and publishes "OrderPlaced" events to Kafka. A Dispatch service consumes those events,
   > picks a courier and sends push notifications through Firebase. Restaurants manage menus in a web
   > portal that talks to the Restaurant service. Payments go to Stripe.

2. While it runs, the button should read **Thinking…**. A review dialog should open with the report,
   counts of added elements and relationships, and a list of changes. 📸
3. Before pressing anything, check that the element count in the workspace has not changed.
4. Judge the draft: are the people, systems, containers and external systems (Stripe, Firebase, Kafka)
   there, with sensible relationship labels and no obvious invention?
5. Press **Apply**. Open the new view and check it is laid out and readable. 📸
6. Press **Undo** once. The whole draft must disappear in one step. Press **Redo**.
7. Repeat steps 1–2 with **ArchiMate** and with **DDD** as the notation, and press **Discard** both
   times. Confirm nothing was added.

## 4. Work with a view
Select **Online Shop – containers** in the **View** list.
1. **Explain this view**: the answer should appear on the page, formatted, and mention real element
   names from the view. Quote two sentences in your report and say whether they are accurate. 📸
2. **Suggest missing relationships**: a review dialog opens. Check each suggestion only connects
   elements that exist and makes sense. Apply one useful suggestion and discard the rest if the dialog
   allows it; otherwise apply all and undo.
3. Pick a non-C4 view (an ArchiMate or DDD view) and use **Translate into a C4 view**. Apply and check
   the new view.

## 5. Review the model
1. On the canvas, create a problem on purpose: add an element with no name or connect two elements with
   an unusual relationship, so **Problems** shows at least one warning.
2. Press **Review against the validation rules**. It should list about five improvements, group related
   validator findings, and mention the problem you created. 📸

## 6. Failure handling
For each case, the app must show a clear error on the page and stay usable (no frozen **Thinking…**):
1. In Settings, change the base URL to `http://localhost:9/v1` (nothing listening). Try **Explain this
   view**.
2. Restore the URL and set the model to `no-such-model-123`. Try **Draft** with a one-line description.
3. Hosted endpoint only: press **Remove key**, try again, and expect an authentication error. Then let me
   re-enter the key.
4. Restore the correct settings. Paste a very long document (around 20 pages of text, for example a
   README copied several times) and press **Draft**. Note how long it takes and what happens.
5. Paste nonsense ("asdf qwer zxcv") and press **Draft**. Expect either an empty or tiny draft or a
   clear message, not a crash.
6. Untick **Enable the assistant**. The buttons must be disabled again.

## Report format
Finish with:
1. **Summary**: one paragraph. Is the assistant useful, and does it keep its promise that nothing is
   applied without review?
2. **Bugs** in a table: `#`, section and step, what you did, expected, what happened, severity
   (blocker / major / minor / cosmetic), screenshot reference.
3. **Answer quality**: for Draft, Explain, Suggest and Review, give each a score from 1 to 5 with one
   line of reasoning and an example of a good or bad output.
4. **Timing**: roughly how long each action took with this endpoint and model.
5. Anything you could not test, and why.
