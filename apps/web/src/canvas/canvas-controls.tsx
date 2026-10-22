import { Panel, useReactFlow, useStore } from '@xyflow/react';
import { Icon } from '../components/icon.tsx';
import { IconButton } from '../components/icon-button.tsx';
import { CANVAS_COPY as C } from '../copy/plan-editor.ts';
import styles from './canvas.module.css';
import { classNames, motionMs } from './canvas-util.ts';
import { ZOOM } from './viewport.ts';

type Props = { onFit: () => void; minimap: boolean; onMinimapChange: (on: boolean) => void };

/** The control bar of every canvas (26 §2.1): zoom out, zoom level (click: 100%), zoom in, fit, minimap. */
export function CanvasControls({ onFit, minimap, onMinimapChange }: Props) {
  const { zoomIn, zoomOut, zoomTo } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const duration = motionMs(200);
  return (
    <Panel position="bottom-left" className={styles.controls}>
      <fieldset aria-label={C.controls} className={styles.controlGroup}>
        <IconButton
          icon="minus"
          label={C.zoomOut}
          className="round"
          disabled={zoom <= ZOOM.min}
          onClick={() => void zoomOut({ duration })}
        />
        <button
          type="button"
          className={styles.zoomLevel}
          aria-label={C.zoomReset}
          title={C.zoomReset}
          onClick={() => void zoomTo(1, { duration })}
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton
          icon="plus"
          label={C.zoomIn}
          className="round"
          disabled={zoom >= ZOOM.max}
          onClick={() => void zoomIn({ duration })}
        />
        <span className={styles.controlSep} aria-hidden="true" />
        <button type="button" className="btn ghost sm" onClick={onFit}>
          <Icon name="target" size="sm" />
          {C.fit}
        </button>
        <IconButton
          icon="map"
          label={C.minimap}
          className={classNames('round', minimap && styles.on)}
          aria-pressed={minimap}
          onClick={() => onMinimapChange(!minimap)}
        />
      </fieldset>
    </Panel>
  );
}
