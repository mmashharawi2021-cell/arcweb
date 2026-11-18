import { circle, distance, point } from '@turf/turf'
type Coordinate=[number,number]
export function rectangle(a:Coordinate,b:Coordinate) { if(a[0]===b[0]||a[1]===b[1])return null;return {type:'Polygon' as const,coordinates:[[a,[b[0],a[1]],b,[a[0],b[1]],a]]} }
export function circleFromPoints(a:Coordinate,b:Coordinate) { const radius=distance(point(a),point(b),{units:'kilometers'});return radius>0?circle(a,radius,{steps:64}).geometry:null }
