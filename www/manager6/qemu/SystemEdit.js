Ext.define('PVE.qemu.SystemInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveQemuSystemPanel',

    onlineHelp: 'qm_system_settings',

    viewModel: {
        data: {
            efi: false,
            addefi: true,
        },

        formulas: {
            efidisk: function (get) {
                return get('efi') && get('addefi');
            },
        },
    },

    onGetValues: function (values) {
        if (values.vga && values.vga.substr(0, 6) === 'serial') {
            values['serial' + values.vga.substr(6, 1)] = 'socket';
        }

        delete values.hdimage;
        delete values.hdstorage;
        delete values.diskformat;

        delete values.preEnrolledKeys; // efidisk
        delete values.version; // tpmstate

        return values;
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        scsihwChange: function (field, value) {
            var me = this;
            if (me.getView().insideWizard) {
                me.getViewModel().set('current.scsihw', value);
            }
        },

        biosChange: function (field, value) {
            var me = this;
            if (me.getView().insideWizard) {
                me.getViewModel().set('efi', value === 'ovmf');
            }
        },

        control: {
            pveScsiHwSelector: {
                change: 'scsihwChange',
            },
            pveQemuBiosSelector: {
                change: 'biosChange',
            },
            '#': {
                afterrender: 'setMachine',
            },
        },

        setMachine: function () {
            let me = this;
            let vm = this.getViewModel();
            let ostype = vm.get('current.ostype');
            if (ostype === 'win11') {
                me.lookup('machine').setValue('q35');
                me.lookup('bios').setValue('ovmf');
                me.lookup('addtpmbox').setValue(true);
            }
        },
    },

    column1: [
        {
            xtype: 'proxmoxKVComboBox',
            value: '__default__',
            deleteEmpty: false,
            fieldLabel: gettext('Graphic card'),
            name: 'vga',
            comboItems: Object.entries(PVE.Utils.kvm_vga_drivers),
        },
        {
            xtype: 'proxmoxKVComboBox',
            name: 'machine',
            reference: 'machine',
            value: '__default__',
            fieldLabel: gettext('Machine'),
            comboItems: [
                ['__default__', PVE.Utils.render_qemu_machine('')],
                ['q35', 'q35'],
            ],
        },
        {
            xtype: 'displayfield',
            value: gettext('Firmware'),
        },
        {
            xtype: 'pveQemuBiosSelector',
            name: 'bios',
            reference: 'bios',
            value: '__default__',
            fieldLabel: 'BIOS',
        },
        {
            xtype: 'proxmoxcheckbox',
            bind: {
                value: '{addefi}',
                hidden: '{!efi}',
                disabled: '{!efi}',
            },
            hidden: true,
            submitValue: false,
            disabled: true,
            fieldLabel: gettext('Add EFI Disk'),
        },
        {
            xtype: 'pveEFIDiskInputPanel',
            name: 'efidisk0',
            storageContent: 'images',
            bind: {
                nodename: '{nodename}',
                hidden: '{!efi}',
                disabled: '{!efidisk}',
            },
            autoSelect: false,
            disabled: true,
            hidden: true,
            hideSize: true,
            usesEFI: true,
        },
    ],

    column2: [
        {
            xtype: 'pveScsiHwSelector',
            name: 'scsihw',
            value: '__default__',
            bind: {
                value: '{current.scsihw}',
            },
            fieldLabel: gettext('SCSI Controller'),
        },
        {
            xtype: 'proxmoxcheckbox',
            name: 'agent',
            uncheckedValue: 0,
            defaultValue: 0,
            deleteDefaultValue: true,
            fieldLabel: gettext('Qemu Agent'),
        },
        {
            // fake for spacing
            xtype: 'displayfield',
            value: ' ',
        },
        {
            xtype: 'proxmoxcheckbox',
            reference: 'addtpmbox',
            bind: {
                value: '{addtpm}',
            },
            submitValue: false,
            fieldLabel: gettext('Add TPM'),
        },
        {
            xtype: 'pveTPMDiskInputPanel',
            name: 'tpmstate0',
            storageContent: 'images',
            bind: {
                nodename: '{nodename}',
                hidden: '{!addtpm}',
                disabled: '{!addtpm}',
            },
            disabled: true,
            hidden: true,
        },
    ],
});
