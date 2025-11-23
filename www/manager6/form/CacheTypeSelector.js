Ext.define('PVE.form.CacheTypeSelector', {
    extend: 'Proxmox.form.KVComboBox',
    alias: ['widget.CacheTypeSelector'],
    comboItems: [
        ['__default__', Proxmox.Utils.defaultText + ' (' + gettext('No cache') + ')'],
        ['directsync', 'Direct sync'],
        ['writethrough', 'Write through'],
        ['writeback', 'Write back'],
        ['unsafe', 'Write back (' + gettext('unsafe') + ')'],
        ['none', gettext('No cache')],
    ],
});
