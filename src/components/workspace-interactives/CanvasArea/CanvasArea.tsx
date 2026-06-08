import { useEffect, useRef } from "react"

interface CanvasAreaProps{
    id?: string,
}
interface Rectangle{
    x: number,
    y: number,
    w: number,
    h: number
}
export default function CanvasArea({}: CanvasAreaProps){

    const canvasRef = useRef<HTMLCanvasElement>(null)
    /*
    const canvas = document.getElementById('myCanvas')
    const ctx = canvas.getContext('2d')
    ctx.fillRect(10, 10, 100, 50)
    */
   const rectData = {
    x: 20,
    y: 50,
    w: 150,
    h: 150
   };
   const canvas = canvasRef.current

   

    useEffect(() => {
        const canvas = canvasRef.current
        if(!canvas) return
        const ctx = canvas.getContext('2d')

        function drawRect(rect: Rectangle){
            const {x, y, w, h} = rect
            ctx?.fillRect(x, y, w, h)
           }

        drawRect(rectData);
        if(!ctx) return
        ctx.beginPath()
        ctx.strokeStyle = "blue";
        ctx.moveTo(20, 20);
        ctx.lineTo(200, 20);
        ctx.stroke();
        ctx.moveTo(200,20)
        ctx.lineTo(200,200);
        ctx.stroke()
        ctx.moveTo(200,200);
        ctx.lineTo(20,200);
        ctx.stroke();
        ctx.moveTo(20,200)
        ctx.lineTo(20,20);
        ctx.stroke();
        
        
    }, [])

    return (
        <>
            <h1>h1 canvas</h1>
            <button>Click Me</button>
            <canvas
            ref={canvasRef}
            width={600}
            height={600}> 
            </canvas>
            <h1>h1 after canvas</h1>
        </>

        
    )
}