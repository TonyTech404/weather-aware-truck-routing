import type { Metric } from '@/lib/risk'

export interface WorkspaceState {
  routeId: string | null
  /** Checkpoint index on the selected route. */
  checkpoint: number | null
  /** Forecast hour after departure shown on the heatmap (0-48). */
  hour: number
  playing: boolean
  metric: Metric
  layers: { heatmap: boolean; checkpoints: boolean; alternatives: boolean }
}

export type WorkspaceAction =
  | { type: 'reset'; routeId: string | null }
  | { type: 'selectRoute'; routeId: string }
  | { type: 'selectCheckpoint'; index: number | null }
  | { type: 'setHour'; hour: number }
  | { type: 'togglePlay' }
  | { type: 'tick'; max: number }
  | { type: 'stopPlaying' }
  | { type: 'setMetric'; metric: Metric }
  | { type: 'toggleLayer'; layer: keyof WorkspaceState['layers'] }

export const initialWorkspace: WorkspaceState = {
  routeId: null,
  checkpoint: null,
  hour: 0,
  playing: false,
  metric: 'risk',
  layers: { heatmap: true, checkpoints: true, alternatives: true },
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'reset':
      return { ...initialWorkspace, routeId: action.routeId, layers: state.layers, metric: state.metric }
    case 'selectRoute':
      return action.routeId === state.routeId ? state : { ...state, routeId: action.routeId, checkpoint: null }
    case 'selectCheckpoint':
      return { ...state, checkpoint: action.index }
    case 'setHour':
      return { ...state, hour: action.hour }
    case 'togglePlay':
      return { ...state, playing: !state.playing }
    case 'tick':
      return { ...state, hour: state.hour >= action.max ? 0 : state.hour + 1 }
    case 'stopPlaying':
      return state.playing ? { ...state, playing: false } : state
    case 'setMetric':
      return { ...state, metric: action.metric }
    case 'toggleLayer':
      return { ...state, layers: { ...state.layers, [action.layer]: !state.layers[action.layer] } }
  }
}
