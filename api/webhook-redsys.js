import { createClient } from '@supabase/supabase-js';
import { createRedsysAPI, SANDBOX_URLS, PRODUCTION_URLS } from 'redsys-easy';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const { processRedirectNotification } = createRedsysAPI({
    urls: process.env.REDSYS_ENV === 'production' ? PRODUCTION_URLS : SANDBOX_URLS,
    secretKey: process.env.REDSYS_SECRET_KEY,
});

const NOMBRES_BARCO = {
    1: 'Capelli Tempest 625',
    2: 'Zodiac Medline II',
    3: 'Faeton 980',
};

async function notificarWhatsapp(reserva) {
    const phone = process.env.CALLMEBOT_PHONE;
    const apikey = process.env.CALLMEBOT_APIKEY;
    if (!phone || !apikey) return;

    const nombreBarco = NOMBRES_BARCO[reserva.barco_id] || `Barco ${reserva.barco_id}`;
    const texto = `Nueva reserva confirmada\n`
        + `Barco: ${nombreBarco}\n`
        + `Fecha: ${reserva.fecha} (${reserva.turno})\n`
        + `Cliente: ${reserva.nombre}\n`
        + `Tel: ${reserva.telefono}\n`
        + `Precio: ${reserva.precio_pagado} EUR`;

    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(texto)}&apikey=${encodeURIComponent(apikey)}`;

    const resp = await fetch(url);
    if (!resp.ok) {
        console.error('CallMeBot respondió con error:', resp.status, await resp.text());
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const notification = processRedirectNotification(req.body);
        const { Ds_Order, Ds_Response } = notification;

        // Códigos de respuesta menores a 100 son pago correcto en Redsys
        const pagoOk = parseInt(Ds_Response, 10) < 100;

        if (pagoOk) {
            // Confirmar la reserva
            const { data: reservaActualizada, error } = await supabase
                .from('reservas')
                .update({ confirmada: true })
                .eq('redsys_order_id', Ds_Order)
                .select()
                .single();

            if (error) throw error;

            console.log(`Reserva confirmada: ${Ds_Order}`);

            // Aviso por WhatsApp: se aísla en su propio try/catch para que un fallo
            // de CallMeBot nunca impida confirmar el pago a Redsys.
            if (reservaActualizada) {
                try {
                    await notificarWhatsapp(reservaActualizada);
                } catch (err) {
                    console.error('Error notificando WhatsApp:', err);
                }
            }

            return res.status(200).send('OK');

        } else {
            // Pago fallido o cancelado, eliminar la reserva
            const { error } = await supabase
                .from('reservas')
                .delete()
                .eq('redsys_order_id', Ds_Order);

            if (error) throw error;

            console.log(`Reserva eliminada por pago fallido: ${Ds_Order}`);
            return res.status(200).send('KO');
        }

    } catch (err) {
        console.error('Error en webhook Redsys:', err);
        return res.status(500).send('ERROR');
    }
}