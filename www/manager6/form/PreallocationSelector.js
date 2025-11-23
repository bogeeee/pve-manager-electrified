Ext.define('PVE.form.preallocationSelector', {
    extend: 'Proxmox.form.KVComboBox',
    alias: ['widget.pvePreallocationSelector'],
    comboItems: [
        ['__default__', Proxmox.Utils.defaultText],
        ['off', 'Off'],
        ['metadata', 'Metadata'],
        ['falloc', 'Full (posix_fallocate)'],
        ['full', 'Full'],
    ],
});
