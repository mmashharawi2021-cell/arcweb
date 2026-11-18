import type { LucideIcon } from 'lucide-react'
import { commandIconRole } from './commandIconRegistry'
export function CommandIcon({id,icon:Icon,size='small'}:{id:string;icon:LucideIcon;size?:'large'|'small'}) {return <Icon aria-hidden="true" size={size==='large'?32:16} strokeWidth={size==='large'?1.6:2} className={'ribbon-button-icon command-icon icon-'+commandIconRole(id)} />}
