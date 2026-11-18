import type { ToolMode } from '../store'
export function ModifyFeaturesPane({ onTool,onDelete,onAttributes }: {onTool:(tool:ToolMode)=>void;onDelete:()=>void;onAttributes:()=>void}) { return <div className="pro-pane-content"><button onClick={()=>onTool('move-vertex')}>Move Vertex</button><button onClick={onDelete}>Delete</button><button onClick={onAttributes}>Attributes</button></div> }
