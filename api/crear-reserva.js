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
        direccion, ciudad, codigo_postal, pais
    } = req.body;

    // Validación de campos obligatorios
    if (!barco_id || !fecha || !turno || !nombre || !email || !telefono || !direccion || !ciudad || !codigo_postal || !pais) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    try {
        const ahora = new Date().toISOString();

        // Comprobar disponibilidad (misma lógica que /api/disponibilidad)
        const { data: reservasExistentes, error: errorReservas } = await supabase
            .from('reservas')
            .select('turno')
            .eq('barco_id', barco_id)
            .eq('fecha', fecha)
            .or(`confirmada.eq.true,expira_en.gt.${ahora}`);

        if (errorReservas) throw errorReservas;

        const turnosOcupados = reservasExistentes.map(r => r.turno);
        const hayCompleto = turnosOcupados.includes('completo');
        const hayMediosDia = turnosOcupados.includes('manana') || turnosOcupados.includes('tarde');

        if (
            hayCompleto ||
            turnosOcupados.includes(turno) ||
            (turno === 'completo' && hayMediosDia)
        ) {
            return res.status(409).json({ error: 'Este turno ya no está disponible' });
        }

        // Obtener precio
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
                precio_pagado: precioData.precio,
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
            DS_MERCHANT_AMOUNT: String(Math.round(precioData.precio * 100)),
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