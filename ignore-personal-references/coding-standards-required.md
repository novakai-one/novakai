
1. Responsibility driven design.

Each module must have 1 and exactly 1 clear responsibility.
Smaller modules must be used and can be incorporated back into the main class/function module.

2. All data transformations, data retrieval, and data creation must use named functions that clearly describe the intent of the code.

A reader should be able to read the module top to bottom and understand the code without reading each line.

3. Each function must have exactly 1 set of actions within the function body that match the name of the function.

4. All non-trivial variables are to use meaningful names.

Bad design: file.content.map((b) => //b.doSomething)
Good design: file.content.map((block) => //block.doSomething)

5. Proper encapsulation. All public methods, fields, and properties must be appropriate and match the intent of the class/module/helper. 

6. Uniform shapes. 

All design choices should utilise uniform shapes where possible.
Reduces risk of bugs, and reduces errors of repsonsibility creep.

E.g. good design:

        if (channel === 'mouse') {
            const d = data as MouseEventData
            shape = bm.receiveMouseEvent(d, trigger, shape)
            shape = sm.receiveMouseEvent(d, trigger, shape)
            shape = dm.receiveMouseEvent(d, trigger, shape)
            shape = lm.receiveMouseEvent(d, trigger, shape)
        }

7. in-line comments should enhance the code readability. Over-reliance makes codebase less readable when the code naming conventions should be able to describe intent of code.

8. Keep coupling of classes to a minimum. Where possible, have one component or class that calls the class being designed.
Any class that is called by more than one class or component needs to have a clear assessment and justification.

9. hooks, stores, and stateful variables should only be used when 100% necessary. Many times an instance variable can be used and many things dont actually need to be in a stateful variable. 

10. 