// CanvasArea — placeholder block component.
// Registered in the COMPONENT_REGISTRY so TextElement.component can reference
// it, but currently renders nothing of substance. Real canvas-block behaviour
// (drawing tools, vector primitives) ships when that feature lands.

// @flowmap-node canvasArea kind=component
export default function CanvasArea() {
    return <canvas width={600} height={600} />
}
