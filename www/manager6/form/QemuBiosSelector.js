Ext.define('PVE.form.QemuBiosSelector', {
    extend: 'PVE.form.FilteredKVComboBox',
    alias: ['widget.pveQemuBiosSelector'],

    comboItems: [
        ['__default__', PVE.Utils.render_qemu_bios('')],
        ['seabios', PVE.Utils.render_qemu_bios('seabios')],
        ['ovmf', PVE.Utils.render_qemu_bios('ovmf')],
    ],

    allowedValuesPerCategory: PVE.qemu.Architecture.allowedFirmware,

    setDefaultDisplay: (arch) => PVE.Utils.render_qemu_bios('', arch),
});
