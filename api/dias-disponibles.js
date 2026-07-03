import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

    const { barco_id, year, month } = req.query;

    if (!barco_id || !year || !month) {
        return res.status(400).json({ error: 'Faltan parámetros: barco_id, year y month son obligatorios' });
    }

    try {
        const ahora = new Date().toISOString();

        // Primer y último día del mes (sin pasar por toISOString para evitar
        // desfases de un día según la zona horaria del servidor)
        const totalDias = new Date(year, month, 0).getDate();
        const fechaInicio = `${year}-${String(month).padStart(2, '0')}-01`;
        const fechaFin = `${year}-${String(month).padStart(2, '0')}-${String(totalDias).padStart(2, '0')}`;

        // Reservas confirmadas o pendientes no caducadas en ese mes
        const { data: reservas, error } = await supabase
            .from('reservas')
            .select('fecha, turno')
            .eq('barco_id', barco_id)
            .gte('fecha', fechaInicio)
            .lte('fecha', fechaFin)
            .or(`confirmada.eq.true,expira_en.gt.${ahora}`);

        if (error) throw error;

        // Precios disponibles para ese barco en ese mes
        const { data: precios, error: errorPrecios } = await supabase
            .from('precios')
            .select('turno, fecha_inicio, fecha_fin')
            .eq('barco_id', barco_id)
            .lte('fecha_inicio', fechaFin)
            .gte('fecha_fin', fechaInicio);

        if (errorPrecios) throw errorPrecios;

        // Para cada día del mes, calcular si tiene algún turno disponible
        const diasNoDisponibles = [];

        for (let dia = 1; dia <= totalDias; dia++) {
            const fecha = `${year}-${String(month).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

            // Turnos con precio para ese día
            const turnosConPrecio = precios
                .filter(p => p.fecha_inicio <= fecha && p.fecha_fin >= fecha)
                .map(p => p.turno);

            if (turnosConPrecio.length === 0) {
                // Fuera de temporada
                diasNoDisponibles.push(fecha);
                continue;
            }

            // Turnos ocupados ese día
            const turnosOcupados = reservas
                .filter(r => r.fecha === fecha)
                .map(r => r.turno);

            const hayCompleto = turnosOcupados.includes('completo');
            const hayManana = turnosOcupados.includes('manana');
            const hayTarde = turnosOcupados.includes('tarde');
            const haySunset = turnosOcupados.includes('sunset');

            // Comprobar si queda algún turno disponible.
            // Sunset (19:00-21:00) es independiente: solo lo bloquea otro sunset.
            const completoDisponible = turnosConPrecio.includes('completo')
                && !hayCompleto && !hayManana && !hayTarde;
            const mananaDisponible = turnosConPrecio.includes('manana')
                && !hayCompleto && !hayManana;
            const tardeDisponible = turnosConPrecio.includes('tarde')
                && !hayCompleto && !hayTarde;
            const sunsetDisponible = turnosConPrecio.includes('sunset')
                && !haySunset;

            if (!completoDisponible && !mananaDisponible && !tardeDisponible && !sunsetDisponible) {
                diasNoDisponibles.push(fecha);
            }
        }

        return res.status(200).json({ barco_id, year, month, diasNoDisponibles });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}
