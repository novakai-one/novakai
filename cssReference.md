# CSS Cheat Sheet (React-focused)

## Selectors

```css
.box        /* class — most common in React */
#id         /* id — avoid in React, use classes */
div         /* element — rarely used in React */
.a .b       /* descendant: .b inside .a */
.a > .b     /* direct child only */
.a.b        /* both classes on same element */
.a, .b      /* both get the same styles */
:hover      /* pseudo-class — mouse over */
:focus      /* keyboard/click focused */
```

> In React you'll mostly use `.className` selectors and occasionally `:hover` / `:focus`.

---

## CSS Custom Properties (vars)

```css
/* Define — usually on :root */
:root {
  --color-primary: #3b82f6;
  --spacing-md: 1rem;
}

/* Use */
.button {
  background: var(--color-primary);
  padding: var(--spacing-md);
}

/* Fallback if var missing */
color: var(--color-primary, black);
```

> `:root` = the whole document. Define once, use everywhere. Change one value → updates everywhere.

---

## Box Model

```css
width / height
padding        /* inside, pushes content in */
border         /* the edge */
margin         /* outside, pushes other elements away */

box-sizing: border-box;   /* padding/border included IN width — use this always */
```

---

## Flexbox

```css
.container {
  display: flex;
  flex-direction: row;        /* row (default) | column */
  justify-content: center;    /* main axis — start | center | end | space-between */
  align-items: center;        /* cross axis — start | center | end | stretch */
  gap: 1rem;                  /* space between children */
  flex-wrap: wrap;            /* allow wrapping */
}

/* On children */
.child {
  flex: 1;          /* grow to fill space equally */
  flex-shrink: 0;   /* don't shrink below natural size */
}
```

> `flex-direction: row` → `justify-content` is horizontal, `align-items` is vertical.
> Flip direction → axes flip too.

---

## Most-used Utilities

```css
/* Display */
display: flex | block | inline | inline-flex | none;

/* Sizing */
width: 100%;
max-width: 600px;
min-height: 100vh;

/* Overflow */
overflow: hidden | scroll | auto;

/* Position (when you need it) */
position: relative;   /* sets reference point for children */
position: absolute;   /* placed relative to nearest relative parent */
top / right / bottom / left: 0;
```

---

> That's the 90% you'll reach for daily. Deeper stuff (grid, transitions, responsive) when you're ready.