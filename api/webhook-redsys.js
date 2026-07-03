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

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const notification = processRedirectNotification(req.body);
        const { Ds_Order, Ds_Response } = notification;

        // Códigos de respuesta menores a 100 son pago correcto en Redsys
        const pagoOk = parseInt(Ds_Response, 10) < 100;

        if (pagoOk) {
            // Confirmar la reserva
            const { error } = await supabase
                .from('reservas')
                .update({ confirmada: true })
                .eq('redsys_order_id', Ds_Order);

            if (error) throw error;

            console.log(`Reserva confirmada: ${Ds_Order}`);
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