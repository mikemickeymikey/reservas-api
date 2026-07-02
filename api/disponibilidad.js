import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  const { barco_id, fecha } = req.query;

  if (!barco_id || !fecha) {
    return res.status(400).json({ error: 'Faltan parámetros: barco_id y fecha son obligatorios' });
  }

  try {
    // Turnos ocupados para ese barco y fecha
    const { data: reservas, error } = await supabase
      .from('reservas')
      .select('turno')
      .eq('barco_id', barco_id)
      .eq('fecha', fecha);

    if (error) throw error;

    const turnosOcupados = reservas.map(r => r.turno);

    // Si hay completo, todo está ocupado
    const todoOcupado = turnosOcupados.includes('completo');

    // Precio para esa fecha
    const { data: precios, error: errorPrecios } = await supabase
      .from('precios')
      .select('turno, precio')
      .eq('barco_id', barco_id)
      .lte('fecha_inicio', fecha)
      .gte('fecha_fin', fecha);

    if (errorPrecios) throw errorPrecios;

    const turnos = ['completo', 'manana', 'tarde', 'sunset'];
    const resultado = turnos.map(turno => {
      const precioData = precios.find(p => p.turno === turno);
      const ocupado = todoOcupado || turnosOcupados.includes(turno) ||
        // Si hay manana y tarde, completo no está disponible
        (turno === 'completo' && (turnosOcupados.includes('manana') || turnosOcupados.includes('tarde')));

      return {
        turno,
        disponible: !!precioData && !ocupado,
        precio: precioData ? precioData.precio : null
      };
    });

    return res.status(200).json({ fecha, barco_id, turnos: resultado });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}