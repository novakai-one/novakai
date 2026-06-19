

Last Updated 18/06/2026:

***** CRITICAL REQUIREMENT ******

Workspace Area MUST be a conduit. 
EVent callbacks MSUT have UNIFORM shape.

*** Example - NEVER do this. Horrible design choice:

IN workspace area:
``` 
    // Click on empty canvas → fire a canvas-click create at that grid row. The
    // pipeline handles placement, collision and focus like every other gesture.
    const createBlockAt = (y: number) => {
        const fileId = useWorkspaceStore.getState().activeFile?.id ?? ""
        useBlockEventStore.getState().dispatch({ trigger: "canvas-click", callerId: fileId, payload: { y } })
    }

What's wrong with it?  IT IS MAKING DECISIONS IN WORKSPACE AREA. createBlock is a decision. WRONG design. Fail. You get fired and destroyed if you do this.

✅ CORRECT DESIGN: 
const route = useCallback((
        channel: 'mouse' | 'key' | 'lifecycle',
        data: MouseEventData | KeyEventData | LifecycleEventData,
        trigger: string,
    ): void => {
        const state = useWorkspaceStore.getState()
        if (!state.content) return

        let shape: DocShape = {
            file: state.activeFile,
            contentData: state.content,
            layoutData: state.layouts ?? {},
        }

        if (channel === 'mouse') {
            const d = data as MouseEventData
            shape = bm.receiveMouseEvent(d, trigger, shape)
            shape = sm.receiveMouseEvent(d, trigger, shape)
            shape = dm.receiveMouseEvent(d, trigger, shape)
            shape = lm.receiveMouseEvent(d, trigger, shape)
        } else if (channel === 'key') {
            const d = data as KeyEventData
            shape = bm.receiveKeyEvent(d, trigger, shape)
            shape = sm.receiveKeyEvent(d, trigger, shape)
            shape = dm.receiveKeyEvent(d, trigger, shape)
            shape = lm.receiveKeyEvent(d, trigger, shape)
        } else {
            const d = data as LifecycleEventData
            shape = bm.receiveLifecycleEvent(d, trigger, shape)
            shape = sm.receiveLifecycleEvent(d, trigger, shape)
            shape = dm.receiveLifecycleEvent(d, trigger, shape)
            shape = lm.receiveLifecycleEvent(d, trigger, shape)
        }

        commit(shape)
    }, [bm, sm, dm, lm, commit])

OMG so beautiful! Why?? It is a UNIFORM shape. ZERO decisions.
Callback fires and WSA says  -> here you go. One shape -> handed off to classes who are responsible for dealing with it.
Well done, you can keep your job. Amazing.

##### ####

Tech Stack:
React - Vite build
Supabase (currently local storage)
Typescript


AI-first workspace overhauling current workflows.

Core of the app: 
1. AI-engine
2. Declarative UX
3. Object-based relational databases

User Interaction:
1. User primarily interacts with the AI using Natural language to describe desired outcome.
	1. AI builds the workspace UI for that Page.
2. User has the ability to make minor changes manually (moving items, column resizing, editing formula)

Key ideas:
- The app has declarative building. User no longer has to learn complex formulas like Excel, Notion, Coda. User describes what they want, and the AI writes the formula.
	- AI does the building that a human would nromally spend a long time trying to do.
	- The output is still the same (i.e. user can see the formula in teh column and edit it manually if they want, but someone with no formula knowledge or technical skillset could use the platformn)
- User no longer spends hours building and maintaining dashboards or building spreadsheets, they describe what they want and the AI executes and enhances the workflow.

Backbone:
- Databases hold all information.
- UX are containers that render information in a way that enhances the user experience.
	- Visual layout IS also data -> just like a DOM tree has the parent at the top. 
		- Spatial location of Block Containers is a way of communicating information and data.
		- This is also stored as part of databases.

Example of how the app can be used:
1. Agent-first approach in business. Agents for each department. E.g. marketing user requests a new proposal built. Marketing agent autonomously connects with the finance user agent. The two agents build teh plan. The plan is then taken to the Sales team agent to discuss customer execution. In the morning the human workforce can log into their account, see the proposal built by marketing agent, with input and data already provided by finance and sales agents, ready for review by human workforce.
2. Student collaboration. Student pastes their study course into the app - key dates, assignments, unit outcomes etc. the app autonomously organises and groups into the app, with a study plan, and task list auto generated. 
	a. Student pastes a topic of what they're learning, the ai engine creates well formatted learning material - markdown ascii notes, interactive html lessons that visually and spatially show concepts. Student can also take notes and convert from document mode to canvas style editing with arrows and spatial drawing to better understand concepts.
	b. Ai engine creates study prompts so coming in each day there are random questions to help with spatial repetition 
	c. user wants to replace excel for analysis and needs to have a table (database) that then is able to reference any other piece of data in the App and other databases.
	

Stage 1. Replacement app for notion, Microsoft word, excel, Obsidian to begin. Personal use.
- Declarative AI funcitonal. 
- Example Usage:
	-  User logs in -> Ai is the personal assistant. Welcomes Chris to the app, has read through his calendar and all the tasks across the workspace. Reminds Chris about upcoming deadling and suggsts tasks and next steps to complete. Has read through all teh personal notes for the past couple of days, summarised and filed them away. Has found connection between ideas from yesterday and those written 4 months ago.
Stage 2. Multi-user collaboration - AI first. 
- Connect AI Agent from user account and communicate with AI agent from another user account to work together.
	- E.g. marketing user requests a new proposal built. Marketing agent autonomously connects with the finance user agent. The two agents build teh plan. The plan is then taken to the Sales team agent to discuss customer execution. In the morning the human workforce can log into their account, see the proposal built by marketing agent, with input and data already provided by finance and sales agents, ready for review by human workforce.
	
Stage 3. All in one integration. Examples:
- Plugin for all major services. 
- The app is connected to services like Figma to draw and build presentaiton decks based on proposal.
- The in-store execution briefs are completed and submitted to 3rd-party for externally hired merchandising team to execute in-store.
- IDE integration so business proposals can be executed in codebases.
- Calendar integration. IOS shortcuts and automation integrations, to sync cross-device. App would be able to integrate so that a task generated on app is then synced with api to show up on users phone home-screen widget.



Current folder overview:
.
├── BuildPlan
│   ├── 260618_BuildPlan.md
│   ├── 260618_PiecesPort_BuildPlan.md
│   ├── 260619_GridCollisionLayout_BuildPlan.md
│   └── 260619_Notes Potential issue regardnng xywh owners
├── Claude.md
├── LEARNINGPLAN.md
├── Mermaid
│   └── mermaid.html
├── ROADMAP.md
├── SUPABASE_SETUP.md
├── __cmtest.mjs
├── dist
│   ├── assets
│   │   ├── index-BXs0BvZL.js
│   │   └── index-BpWTlYTL.css
│   ├── favicon.svg
│   ├── icons.svg
│   └── index.html
├── dist-verify
│   ├── assets
│   │   ├── index-BbTBPokK.js
│   │   └── index-ByD998Cy.css
│   ├── favicon.svg
│   ├── icons.svg
│   └── index.html
├── eslint.config.js
├── ignore-personal-references
│   ├── Vite defaultREADME.md
│   ├── cssReference.md
│   └── sidebar-v2 copy.html
├── index.html
├── package-lock.json
├── package.json
├── public
│   ├── favicon.svg
│   └── icons.svg
├── src
│   ├── App.css
│   ├── App.tsx
│   ├── assets
│   │   ├── hero.png
│   │   ├── react.svg
│   │   └── vite.svg
│   ├── auth
│   │   ├── Login.tsx
│   │   └── useAuthStore.tsx
│   ├── components
│   │   ├── Editor.tsx
│   │   ├── editor.css
│   │   ├── footer
│   │   │   ├── Footer.tsx
│   │   │   └── footer.css
│   │   ├── header
│   │   │   ├── Header.tsx
│   │   │   └── header.css
│   │   ├── panels
│   │   │   ├── left-panel
│   │   │   │   ├── LeftPanel.tsx
│   │   │   │   └── left-panel.css
│   │   │   ├── right-panel
│   │   │   │   ├── RightPanel.tsx
│   │   │   │   └── right-panel.css
│   │   │   └── shared
│   │   │       ├── panel
│   │   │       │   ├── Panel.tsx
│   │   │       │   └── panel.css
│   │   │       ├── panel-body
│   │   │       │   ├── PanelBody.tsx
│   │   │       │   ├── PanelBodyItem.tsx
│   │   │       │   ├── panel-body-item.css
│   │   │       │   └── panel-body.css
│   │   │       ├── panel-header
│   │   │       │   ├── PanelHeader.tsx
│   │   │       │   └── panel-header.css
│   │   │       ├── panel-header-tile
│   │   │       │   ├── PanelHeaderTile.tsx
│   │   │       │   └── panel-header-tile.css
│   │   │       └── panel-toggle
│   │   │           ├── PanelToggle.tsx
│   │   │           └── panel-toggle.css
│   │   ├── store
│   │   │   ├── useBlockEventStore.tsx
│   │   │   └── useWorkspaceStore.tsx
│   │   ├── workspace
│   │   │   ├── WorkspaceArea.tsx
│   │   │   ├── WorkspaceEmptyState.tsx
│   │   │   ├── blockMutations.ts
│   │   │   ├── useWorkspacePointerBridge.ts
│   │   │   ├── workspace-empty-state.css
│   │   │   ├── workspace.css
│   │   │   └── workspaceLayout.ts
│   │   └── workspace-blocks
│   │       ├── CanvasArea
│   │       │   └── CanvasArea.tsx
│   │       ├── ContentArea
│   │       │   ├── ContentArea.tsx
│   │       │   └── content-area.css
│   │       └── blocks
│   │           └── blockManager.ts
│   ├── design-demo
│   │   └── DesignDemo.tsx
│   ├── draggable
│   │   ├── dragContainer
│   │   │   ├── DragContainer.tsx
│   │   │   ├── drag-container.css
│   │   │   ├── plan.excalidraw
│   │   │   └── planning.drawio
│   │   ├── dragHandle
│   │   │   ├── DragHandle.tsx
│   │   │   └── drag-handle.css
│   │   └── dragManager
│   │       └── DragManager.ts
│   ├── index.css
│   ├── layout
│   │   ├── collisionManager.ts
│   │   ├── grid.ts
│   │   ├── layoutManager.ts
│   │   └── useLayoutStore.tsx
│   ├── lib
│   │   └── supabase.ts
│   ├── main.tsx
│   ├── selection
│   │   └── selectionManager
│   │       ├── SelectionManager.ts
│   │       ├── SelectionPoint.ts
│   │       ├── SelectionState.ts
│   │       ├── blockSelectionStore.ts
│   │       ├── caretNavigation.ts
│   │       ├── clipboard.ts
│   │       ├── clipboardController.ts
│   │       ├── domHelpers.ts
│   │       ├── highlightRenderer.ts
│   │       ├── pointerGestures.ts
│   │       ├── selectionExtend.ts
│   │       └── types.ts
│   ├── storage
│   │   └── useDocumentStorage.tsx
│   ├── theme
│   │   ├── applyTheme.ts
│   │   ├── themes.ts
│   │   └── useThemeStore.tsx
│   ├── types
│   │   ├── registry.ts
│   │   └── types.ts
│   └── vite-env.d.ts
├── supabase
│   └── schema.sql
├── tsconfig.app.json
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts



---

Project name ideas:

Delta
Delta base
BlockBase
Novus -> hmm not sure if it rolls of the tongue.

Something with the word base to signal databases.
Delta I can imagine is easy to say -> put it in delta. Get Delta to do it. Could be shortened to DB. What does db say?

HomeBase
PowerBase.
OneBase

Current front runner for name: **Novari**


**Novari** is a built name, but it is heavily rooted in real linguistic patterns. It blends two specific Latin concepts:

1. **Novus / Nova:** Meaning _new_ or _fresh start_ (the paradigm shift).
    
2. **Varius / Varia:** Meaning _diverse_, _changing_, or _flexible_ (the ultimate relational database/flexible doc engine).
    

Linguistically, it translates perfectly to **"Flexible New Era"** or **"The Dynamic Evolution."**



---

Coding standards:

1. uniform event handler callbacks used.
	- E.g. WorkspaceArea has a unifrom mouse event handler:
	- const handleMouseEvent = (mouseData: MouseEventData, trigger: string)

```code
	  //WorkspaceArea is the conduit -> Container never touches SM directly.
	  //Just forward the raw mouse data + trigger to SM's public method.
	  const handleMouseEvent = (mouseData: MouseEventData, trigger:  string) => {
	  sm.receiveMouseEvent(mouseData, trigger)
	  //redirect to the components and classes that should be told.
	  }

```
---


2. Strict types used and written in all non-obvious areas.
3. Code is optimised for readability over brevity. Use code that can be read by student and junior/dev level. The functionality must be maintained at a high level, but the writing style must be easy to follow and understand.
4. Variabe and function names should help the reader understand what the code is doing
5. Style to be included in separate styles sheet. CSS variables used to allow for updated themes in root styles.css
6. Components must have one clear responsibility. Helper classes, and ts files must be utilised to keep each file small, isolated and readable.
7. Types to be included in types.ts 

---

Next milestones:

Mostly completed 18th June
1. Operational drag and drop -> main information and features wired (excluding Collision Management)


```Mermaid
classDiagram including planned helper classes.
    %% ====================================================
    %% TODO: Replace "TBD" with real responsibilities/state
    %% ====================================================

    class WorkspaceArea {
        Responsibilities: TBD
        Memory: TBD
    }

    class WorkspaceActionRouter {
        Responsibilities: handles user interactions
        Memory: TBD
    }

    class DragContainer {
        Responsibilities: TBD
        Memory: layoutData
        Memory: dragContainerProps
    }

    class DragHandle {
        Responsibilities: TBD
        Memory: TBD
    }

    class DragManager {
        Responsibilities: TBD
        Memory: TBD
    }

    class ContentArea {
        Responsibilities: TBD
        Memory: TextElement
    }

    class File {
        Responsibilities: TBD
        Memory: TBD
    }

    class Search {
        Responsibilities: TBD
        Memory: TBD
    }

    class VersionControl {
        Responsibilities: TBD
        Memory: TBD
    }

    class PermissionManager {
        Responsibilities: TBD
        Memory: TBD
    }

    class CollisionManager {
        Responsibilities: TBD
        Memory: TBD
    }

    class BlockCreator {
        Responsibilities: TBD
        Memory: TBD
    }

    class Clipboard {
        Responsibilities: TBD
        Memory: TBD
    }

    class SelectionManager {
        Responsibilities: TBD
        Memory: TBD
    }

    %% ====================================================
    %% Relationships visible from your Figma diagram
    %% Add more as you map them out
    %% ====================================================
    WorkspaceArea *-- DragContainer
    WorkspaceArea *-- ContentArea
    DragContainer *-- ContentArea
    DragContainer --> DragHandle