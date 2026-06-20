
- Clipboard Manager

New Selection Manager aka ClaudeSelectionManager

- [ ] Build Range Module & private field in SM
- Build Range -> range should be built 100% of the time, and stored as private field.
- Range -> must be passed to clipboard manager 100% of the time. 
- CM decides if this is useful or not.

- [ ] ensure clipboard manager is called 100% of the time. 
- SM does not tell CM what to do. 
- SM routes to Cm with teh same routing principle that WSA uses with SM.
- SM has no opinion and does not tell CM what to do -> CM makes its own decisions from the trigger words and information it receives.

- [ ] SM to have switch statements for trigger-words to be able to handle all triggers.
 src/components/workspace/trigger-words.ts



Review:
- [ ] Review what blockManager.ts does in blockCreator.

- What is the responsibility of this module.
- Should clipboard manager be using this module to create blocks as now there are two things creating
- Or is it not a creep because clipboard manager already has blocks to begin with. To be reviewed.

