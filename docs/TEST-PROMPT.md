# Prompt: exploratory test of Vastitecture

Copy everything below the line into an AI agent that can see and control the screen (for example
Claude with computer use), or hand it to a human tester. Fill in the two `<…>` placeholders first.

---

You are testing **Vastitecture**, a local-first desktop app for software architecture modelling
(ArchiMate, C4, DDD and TOGAF in one shared model). Your job is to find bugs, not to praise the app.
Work through every section below, in order, and record what actually happens.

**Setup**
- The app is installed at `<path or "Applications › Vastitecture">`. If macOS says it cannot verify the
  developer, open System Settings › Privacy & Security and press **Open Anyway**.
- Sample discovery files are in `<path to a clone of the repository>/fixtures/discovery/`.
- Create an empty folder `~/vastitecture-test` for the workspace.

**Rules**
- Take a screenshot at every step marked 📸 and whenever something looks wrong.
- Never sign in to a real ServiceNow, Google Cloud, Azure or AWS account unless I give you credentials
  in this prompt. Use the sample files.
- If a step fails, note it, try once more, then move on. Don't stop the whole run for one failure.
- After every section, quit nothing; keep working in the same workspace unless told otherwise.

## 1. First launch and workspace files
1. Launch the app. It should load within a few seconds, not stay on "Loading…". 📸
2. **New workspace** › **Sample: online shop in every notation** › **Create in a folder…** › choose
   `~/vastitecture-test`.
3. Confirm the dialog shows the folder path and that **Show in Finder** opens it.
4. In Finder, check that `~/vastitecture-test` now contains `vastitecture.yaml` and a `model/` folder
   with `elements/…/*.yaml`, `relationships.yaml` and views. 📸
5. Quit the app completely and relaunch it. The same workspace should reopen automatically.

## 2. Drawing on the canvas
1. Open the view **Online Shop – containers**. 📸
2. Add a new element from the palette, rename it to `Test Service`, connect it to **Order API**.
3. Undo three times, then redo three times; the canvas must end where it was.
4. Multi-select two elements and use **Align…** and **Auto-layout**. Use **Fit** and the minimap.
5. Export the view as **SVG** and **PNG**; open both files and check they look right.
6. Wait for **Saved**, then check in Finder/a text editor that a new YAML file for `Test Service`
   exists and that `relationships.yaml` gained one entry.

## 3. One model, many views
1. Select **Order API** and rename it to `Ordering API`.
2. Use "Show in other views" and visit its C4, ArchiMate and DDD appearances. The new name must show
   everywhere. 📸
3. Open the **Code** split view on a view; edit a name in the YAML/DSL text and confirm the canvas
   updates, and vice versa.
4. Open **Problems** and note any validation messages.

## 4. Inventory and analysis pages
Visit each page in the left sidebar and do one real action on each:
- **Fact sheets**: edit an owner inline; filter the table.
- **Capability map**: switch the heat-map colouring. 📸
- **Lifecycle roadmap**: check that phases render on a timeline.
- **Impact analysis**: ask what breaks if **Orders DB** is retired. List the result. 📸
- **Decisions**: create an ADR, link it to an element, check it appears in that element's properties.
- **Catalogs and matrices**: export one report to CSV and open it.
- **Cross-notation mapping**, **Architecture repository**, **Plugins**, **Settings**: open each and
  note anything broken or confusing.
- **Assistant**: it should be off by default. Don't configure it unless I give you an endpoint.

## 5. Import and export
1. **Export…** the workspace to Structurizr DSL, ArchiMate exchange XML, Mermaid and draw.io.
2. Create a second, blank workspace (**Keep inside the app (no folder)** is fine) and **Import** the
   Structurizr and ArchiMate files back. Compare element counts with the original.

## 6. Discovery connectors (read-only)
Go back to the `~/vastitecture-test` workspace and open **Discover**. For each connector below: add the
listed files with **Add files…**, press **Discover**, read the review screen, take a 📸, then **Apply**.

| Connector | Files in `fixtures/discovery/` | Review should start with |
| --- | --- | --- |
| ServiceNow CMDB | all four files in `servicenow/` | `ServiceNow: 8 configuration item(s), 8 relationship(s)` and a note that `cmdb_ci_ip_phone` was not modelled |
| Google Cloud (read-only) | all files in `gcp/` | `Google Cloud: 9 resource(s) in project shop-prod-123` |
| Microsoft Azure (read-only) | all files in `azure/` | `Azure: 7 resource(s) in 2 resource group(s)` |
| Kubernetes / Helm | `k8s.yaml`, `chart/Chart.yaml` | `Kubernetes: 4 workload(s), 3 service(s)…` |

Then:
1. Before pressing Apply the first time, confirm nothing was added to the model yet.
2. After Apply, open the new "(discovered)" views and check the nesting (for example `api-1` inside
   subnet `private-eu` inside `shop-vpc`; `aks-shop` inside subnet `aks`). 📸
3. Run the ServiceNow connector again with the same files. The review must say **Nothing would change.**
4. On the ServiceNow connector, check the Password and token fields hide what you type.
5. If `gcloud` or `az` is installed and signed in on this Mac, and I said so here: `<yes/no>`, press
   **Read from my gcloud login** / **Read from my Azure CLI login** and report what it read. Otherwise
   skip this step.

## 7. Robustness
1. While the app is open, edit an element's YAML file in a text editor and save. The app should pick
   up the change, or offer a merge view if you also changed it in the app.
2. Type in the search (Ctrl/Cmd+P) and the command palette; check results are relevant.
3. Toggle the theme to dark and back; look for unreadable text. 📸
4. Use only the keyboard for one minute (Tab, arrows, Enter) to move between elements and rename one.

## Report format
Finish with:
1. **Summary**: one paragraph. Would you trust this app with real architecture work today?
2. **Bugs** in a table: `#`, section and step, what you did, what you expected, what happened,
   severity (blocker / major / minor / cosmetic), screenshot reference.
3. **Confusing UX**: things that worked but were hard to find or understand.
4. **Passed**: the section numbers that worked with no issues.
5. Anything you could not test, and why.
