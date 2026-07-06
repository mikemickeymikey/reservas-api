import { createClient } from '@supabase/supabase-js';
import { createRedsysAPI, SANDBOX_URLS, PRODUCTION_URLS } from 'redsys-easy';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const { createRedirectForm } = createRedsysAPI({
    urls: process.env.REDSYS_ENV === 'production' ? PRODUCTION_URLS : SANDBOX_URLS,
    secretKey: process.env.REDSYS_SECRET_KEY,
});

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

    const {
        barco_id, fecha, turno,
        nombre, email, telefono, dni,
        direccion, ciudad, codigo_postal, pais,
        descuento_codigo
    } = req.body;

    // Validación de campos obligatorios
    if (!barco_id || !fecha || !turno || !nombre || !email || !telefono || !direccion || !ciudad || !codigo_postal || !pais) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    try {
        const ahora = new Date().toISOString();

        // Comprobar disponibilidad
        const { data: reservasExistentes, error: errorReservas } = await supabase
            .from('reservas')
            .select('turno')
            .eq('barco_id', barco_id)
            .eq('fecha', fecha)
            .or(`confirmada.eq.true,expira_en.gt.${ahora}`);

        if (errorReservas) throw errorReservas;

        const turnosOcupados = reservasExistentes.map(r => r.turno);
        const hayCompleto = turnosOcupados.includes('completo');
        const hayManana = turnosOcupados.includes('manana');
        const hayTarde = turnosOcupados.includes('tarde');
        const haySunset = turnosOcupados.includes('sunset');

        const conflicto =
            (turno === 'completo' && (hayCompleto || hayManana || hayTarde)) ||
            (turno === 'manana' && (hayCompleto || hayManana)) ||
            (turno === 'tarde' && (hayCompleto || hayTarde)) ||
            (turno === 'sunset' && haySunset);

        if (conflicto) {
            return res.status(409).json({ error: 'Este turno ya no está disponible' });
        }

        // Obtener precio base
        const { data: precioData, error: errorPrecio } = await supabase
            .from('precios')
            .select('precio')
            .eq('barco_id', barco_id)
            .eq('turno', turno)
            .lte('fecha_inicio', fecha)
            .gte('fecha_fin', fecha)
            .single();

        if (errorPrecio || !precioData) {
            return res.status(400).json({ error: 'No hay precio disponible para esa fecha y turno' });
        }

        // Aplicar descuento si hay código
        let precioFinal = precioData.precio;

        if (descuento_codigo) {
            const hoy = new Date().toISOString().split('T')[0];
            const { data: descuentos, error: errorDescuento } = await supabase
                .from('descuentos')
                .select('codigo, porcentaje, fecha_inicio, fecha_fin')
                .eq('activo', true);

            if (errorDescuento) throw errorDescuento;

            // Comparación exacta en JS (case-insensitive) en vez de ilike, que
            // interpretaría "%" o "_" en el código recibido como comodines SQL
            // y podría hacer coincidir cualquier descuento activo sin conocerlo.
            const descuento = descuentos.find(d =>
                d.codigo.toLowerCase() === descuento_codigo.toLowerCase()
                && (!d.fecha_inicio || d.fecha_inicio <= hoy)
                && (!d.fecha_fin || d.fecha_fin >= hoy)
            );

            if (descuento) {
                precioFinal = precioData.precio * (1 - descuento.porcentaje / 100);
                precioFinal = Math.round(precioFinal * 100) / 100;
            }
            // Si el código no es válido simplemente se ignora y se cobra el precio completo
        }

        // Generar order_id único (Redsys: máx 12 caracteres alfanuméricos)
        const orderId = Date.now().toString().slice(-12);

        // Expiración: 30 minutos desde ahora
        const expiraEn = new Date(Date.now() + 30 * 60 * 1000).toISOString();

        // Insertar reserva como no confirmada
        const { error: errorInsert } = await supabase
            .from('reservas')
            .insert({
                barco_id,
                fecha,
                turno,
                nombre,
                email,
                telefono,
                dni: dni || null,
                direccion,
                ciudad,
                codigo_postal,
                pais,
                precio_pagado: precioFinal,
                redsys_order_id: orderId,
                confirmada: false,
                expira_en: expiraEn
            });

        if (errorInsert) throw errorInsert;

        // Generar formulario Redsys
        const form = createRedirectForm({
            DS_MERCHANT_MERCHANTCODE: process.env.REDSYS_FUC,
            DS_MERCHANT_TERMINAL: process.env.REDSYS_TERMINAL,
            DS_MERCHANT_ORDER: orderId,
            DS_MERCHANT_AMOUNT: String(Math.round(precioFinal * 100)), // en céntimos
            DS_MERCHANT_CURRENCY: '978', // EUR
            DS_MERCHANT_TRANSACTIONTYPE: '0',
            DS_MERCHANT_URLOK: `${process.env.URL_BASE}/reserva-ok.html`,
            DS_MERCHANT_URLKO: `${process.env.URL_BASE}/reserva-ko.html`,
            DS_MERCHANT_MERCHANTURL: `${process.env.API_URL}/api/webhook-redsys`,
        });

        return res.status(200).json({ form });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}