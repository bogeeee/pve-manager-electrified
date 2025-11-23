Ext.define('PVE.qemu.BiosEdit', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveQemuBiosEdit',

    onlineHelp: 'qm_bios_and_uefi',
    subject: 'BIOS',
    autoLoad: true,

    viewModel: {
        data: {
            bios: '__default__',
            efidisk0: false,
        },
        formulas: {
            showEFIDiskHint: (get) => get('bios') === 'ovmf' && !get('efidisk0'),
        },
    },

    items: [
        {
            xtype: 'pveQemuBiosSelector',
            onlineHelp: 'qm_bios_and_uefi',
            name: 'bios',
            value: '__default__',
            bind: '{bios}',
            fieldLabel: 'BIOS',
        },
        {
            xtype: 'displayfield',
            name: 'efidisk0',
            bind: '{efidisk0}',
            hidden: true,
        },
        {
            xtype: 'displayfield',
            userCls: 'pmx-hint',
            value: gettext(
                'You need to add an EFI disk for storing the EFI settings. See the online help for details.',
            ),
            bind: {
                hidden: '{!showEFIDiskHint}',
            },
        },
    ],
});
