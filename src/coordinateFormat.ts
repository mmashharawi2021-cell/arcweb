import { projectPosition,utmCodeFor,WGS84 } from './crs'
import type { CoordinateFormat } from './ui/uiSettings'
export function formatCoordinates(longitude:number,latitude:number,format:CoordinateFormat):string {
 if(format==='utm'){const code=utmCodeFor(longitude,latitude);const projected=projectPosition(WGS84,code,[longitude,latitude]);return projected?`${code}: ${projected[0].toFixed(1)} E ${projected[1].toFixed(1)} N`:'Unavailable'}
 const angle=(value:number,positive:string,negative:string)=>{const absolute=Math.abs(value),degrees=Math.floor(absolute),minutes=(absolute-degrees)*60;const suffix=value<0?negative:positive;if(format==='dd')return `${absolute.toFixed(6)}° ${suffix}`;if(format==='ddm')return `${degrees}° ${minutes.toFixed(4)}' ${suffix}`;return `${degrees}° ${Math.floor(minutes)}' ${((minutes%1)*60).toFixed(2)}" ${suffix}`}
 return angle(longitude,'E','W')+', '+angle(latitude,'N','S')
}
