Ext.define('PVE.form.BackupCompressionSelector', {
    extend: 'Proxmox.form.KVComboBox',
    alias: ['widget.pveBackupCompressionSelector'],
    comboItems: [
        ['0', Proxmox.Utils.noneText],
        ['lzo', 'LZO (' + gettext('fast') + ')'],
        ['gzip', 'GZIP (' + gettext('good') + ')'],
        ['zstd', 'ZSTD (' + gettext('fast and good') + ')'],
    ],
});
