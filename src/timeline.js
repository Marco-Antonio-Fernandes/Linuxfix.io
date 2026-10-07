import { createElement } from 'react'

export function splitTimelineDescription(description){
  const lines=String(description??'').split('\n')
  const title=String(lines.shift()||'').trim()
  return {title,note:lines.join('\n').trim()}
}

const timelineDescription=(title,note)=>note
  ?createElement('span',{className:'timeline-entry-description'},createElement('strong',null,title),createElement('em',null,note))
  :title

export function mergeTimelineNotes(items){
  const source=Array.isArray(items)?items:[]
  const merged=[]
  for(let index=0;index<source.length;index++){
    const item=source[index]
    if(item.event_type==='status_changed'){
      const next=source[index+1]
      if(next?.event_type==='status_note'){
        const parsed=splitTimelineDescription(next.description)
        const note=parsed.title===item.description?(parsed.note||''):parsed.note||parsed.title
        merged.push({...item,description:timelineDescription(item.description,note)})
        index++
        continue
      }
      merged.push({...item})
      continue
    }
    if(item.event_type==='status_note'){
      const parsed=splitTimelineDescription(item.description)
      const next=source[index+1]
      if(next?.event_type==='status_changed'){
        merged.push({...next,description:timelineDescription(next.description,parsed.note||parsed.title)})
        index++
        continue
      }
      const previous=merged[merged.length-1]
      if(previous?.event_type==='status_changed'){
        merged[merged.length-1]={...previous,description:timelineDescription(previous.description,parsed.note||parsed.title)}
        continue
      }
      merged.push({...item,description:timelineDescription('Nota',parsed.note||parsed.title)})
      continue
    }
    merged.push({...item})
  }
  return merged
}
