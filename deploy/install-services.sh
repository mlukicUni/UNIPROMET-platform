#!/usr/bin/env bash
# Instalacija/osvezavanje sistemskih delova na Linux serveru. Pokrenuti ponovo posle svake izmene
# fajlova u deploy/ (systemd jedinice, update.sh, logrotate) - automatsko azuriranje ih ne menja.
#
#   sudo bash /opt/unipromet-admin/deploy/install-services.sh
#
# Glavni servis (unipromet-admin) se ovde samo osvezava; enable/start radi se rucno pri prelasku.
set -euo pipefail
D=/opt/unipromet-admin/deploy

[ "$(id -u)" = 0 ] || { echo "Pokrenuti sa sudo"; exit 1; }

install -m 644 "$D/unipromet-admin.service" /etc/systemd/system/unipromet-admin.service
install -m 644 "$D/unipromet-update.service" /etc/systemd/system/unipromet-update.service
install -m 644 "$D/unipromet-update.timer" /etc/systemd/system/unipromet-update.timer
install -m 644 "$D/unipromet-backup.service" /etc/systemd/system/unipromet-backup.service
install -m 644 "$D/unipromet-backup.timer" /etc/systemd/system/unipromet-backup.timer
install -m 755 "$D/update.sh" /usr/local/sbin/unipromet-update
install -m 644 "$D/logrotate-unipromet-admin" /etc/logrotate.d/unipromet-admin

systemctl daemon-reload
systemctl enable --now unipromet-update.timer unipromet-backup.timer
logrotate --debug /etc/logrotate.d/unipromet-admin >/dev/null 2>&1 || { echo "logrotate konfiguracija nije ispravna"; exit 1; }

echo "Instalirano. Tajmeri:"
systemctl list-timers 'unipromet-*' --no-pager
