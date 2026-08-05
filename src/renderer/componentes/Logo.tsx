/**
 * Marca de Alpha Gestion.
 *
 * Es la misma pieza que el icono de la aplicacion (build/icon.svg): baldosa
 * redondeada con degradado dorado, trama diagonal tenue y la alfa griega en
 * blanco. Se dibuja en SVG inline —no como imagen— para que escale sin perder
 * nitidez en cualquier tamano y siga el tema sin pedir archivos al servidor.
 *
 * La alfa va en serif: el trazo con contraste grueso/fino es lo que la separa
 * de una "a" latina a simple vista.
 */

interface Props {
  /** Lado de la baldosa en pixeles. */
  readonly tamano?: number;
  /** Muestra el nombre debajo del simbolo. */
  readonly conNombre?: boolean;
  readonly className?: string;
}

/** Ids unicos por instancia: dos logos en la misma pagina no deben pisarse. */
let contador = 0;

export function Logo({ tamano = 96, conNombre = false, className }: Props): JSX.Element {
  contador += 1;
  const sufijo = `logo-${contador}`;

  return (
    <div className={['flex flex-col items-center', className ?? ''].join(' ')}>
      <svg
        viewBox="0 0 512 512"
        width={tamano}
        height={tamano}
        role="img"
        aria-label="Alpha Gestion"
        className="drop-shadow-panel"
      >
        <defs>
          {/* Dorado desde arriba a la derecha hacia el marron profundo abajo a la izquierda. */}
          <linearGradient id={`fondo-${sufijo}`} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#cfa04c" />
            <stop offset="0.45" stopColor="#8d5f23" />
            <stop offset="1" stopColor="#3a2208" />
          </linearGradient>

          {/* Trama diagonal apenas perceptible: le da textura sin ensuciar. */}
          <pattern
            id={`trama-${sufijo}`}
            width="14"
            height="14"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="7" height="14" fill="#ffffff" opacity="0.05" />
          </pattern>

          <clipPath id={`recorte-${sufijo}`}>
            <rect x="0" y="0" width="512" height="512" rx="118" />
          </clipPath>
        </defs>

        <g clipPath={`url(#recorte-${sufijo})`}>
          <rect width="512" height="512" fill={`url(#fondo-${sufijo})`} />
          <rect width="512" height="512" fill={`url(#trama-${sufijo})`} />
        </g>

        <text
          x="256"
          y="248"
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="Palatino, 'Palatino Linotype', 'Times New Roman', Georgia, serif"
          fontSize="330"
          fill="#ffffff"
        >
          &#945;
        </text>
      </svg>

      {conNombre && (
        <p
          className="mt-4 font-sans font-bold tracking-[0.08em] text-masa-900"
          style={{ fontSize: Math.max(tamano * 0.19, 14) }}
        >
          ALPHA GESTIÓN
        </p>
      )}
    </div>
  );
}
