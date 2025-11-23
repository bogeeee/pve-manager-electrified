Ext.define('PVE.form.iScsiProviderSelector', {
    extend: 'Proxmox.form.KVComboBox',
    alias: ['widget.pveiScsiProviderSelector'],
    comboItems: [
        ['comstar', 'Comstar'],
        ['istgt', 'istgt'],
        ['iet', 'IET'],
        ['LIO', 'LIO'],
    ],
});
