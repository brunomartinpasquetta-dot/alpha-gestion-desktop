/**
 * Resolucion de iconos por nombre.
 *
 * El registro de modulos guarda un nombre en texto (no el componente) porque ese
 * nombre viaja por IPC hasta el proceso main y vuelve en la barra de tareas. Aca
 * se traduce a un icono de lucide.
 *
 * Criterio: cada icono representa la FUNCION, no una metafora generica. En una
 * fabrica de alfajores, "insumos" es trigo y "productos" es una galletita: se
 * reconocen de un vistazo, que es lo unico que importa a 28px.
 */

import {
  Banknote,
  BarChart3,
  BookText,
  Boxes,
  Building2,
  ChefHat,
  ClipboardList,
  Cookie,
  Factory,
  HandCoins,
  Landmark,
  LayoutDashboard,
  ShoppingCart,
  Square,
  Tag,
  Truck,
  UserCog,
  Users,
  Wheat,
  type LucideIcon,
} from 'lucide-react';

const ICONOS: Readonly<Record<string, LucideIcon>> = {
  tablero: LayoutDashboard,
  /** Materias primas: harina, leche. */
  insumos: Wheat,
  /** Productos terminados: los alfajores. */
  productos: Cookie,
  /** Maestro de articulos: el catalogo completo. */
  articulos: Boxes,
  recetas: ChefHat,
  ordenes: Factory,
  /** Pedidos de clientes, muchos cargados desde el celular. */
  pedidos: ClipboardList,
  ventas: ShoppingCart,
  /** Compras: lo que llega a la fabrica. */
  compras: Truck,
  /** Caja diaria: el efectivo del turno. */
  caja: Banknote,
  /** Caja general: la tesoreria consolidada. */
  'caja-general': Landmark,
  /** Cuentas corrientes: lo que se debe y se cobra. */
  cuentas: HandCoins,
  clientes: Users,
  proveedores: Building2,
  precios: Tag,
  estadisticas: BarChart3,
  contabilidad: BookText,
  usuarios: UserCog,
};

interface Props {
  readonly nombre: string;
  readonly className?: string;
  readonly strokeWidth?: number;
}

export function Icono({ nombre, className, strokeWidth }: Props): JSX.Element {
  const Componente = ICONOS[nombre] ?? Square;
  return <Componente className={className} strokeWidth={strokeWidth ?? 1.75} aria-hidden="true" />;
}
