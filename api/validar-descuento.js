import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

    const { codigo, fecha } = req.query;

    if (!codigo || !fecha) {
        return res.status(400).json({ error: 'Faltan parámetros: codigo y fecha son obligatorios' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return res.status(400).json({ error: 'Formato de fecha inválido, debe ser YYYY-MM-DD' });
    }

    try {
        const { data: descuentos, error } = await supabase
            .from('descuentos')
            .select('codigo, porcentaje, fecha_inicio, fecha_fin')
            .eq('activo', true);

        if (error) throw error;

        const descuento = descuentos.find(d =>
            d.codigo.toLowerCase() === codigo.toLowerCase()
            && (!d.fecha_inicio || d.fecha_inicio <= fecha)
            && (!d.fecha_fin || d.fecha_fin >= fecha)
        );

        if (!descuento) {
            return res.status(200).json({ valido: false });
        }

        return res.status(200).json({ valido: true, porcentaje: descuento.porcentaje });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}
