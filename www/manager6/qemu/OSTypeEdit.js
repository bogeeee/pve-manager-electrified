Ext.define('PVE.qemu.OSTypeInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveQemuOSTypePanel',
    onlineHelp: 'qm_os_settings',
    insideWizard: false,

    controller: {
        xclass: 'Ext.app.ViewController',
        control: {
            'combobox[name=osbase]': {
                change: 'onOSBaseChange',
            },
        },
        onOSBaseChange: function (field, value) {
            let me = this;
            me.lookup('ostype').getStore().setData(PVE.Utils.kvm_ostypes[value]);
        },
    },

    setArch: function (arch) {
        let me = this;
        me.arch = arch;

        let osbaseStore = me.lookup('osbase').getStore();
        osbaseStore.clearFilter();
        let list = PVE.qemu.Architecture.kvmOSTypes[arch]?.bases;
        if (list) {
            osbaseStore.addFilter((rec) => list.indexOf(rec.data.field1) !== -1);
        }

        let ostypeStore = me.lookup('ostype').getStore();
        ostypeStore.clearFilter();
        list = PVE.qemu.Architecture.kvmOSTypes[arch]?.ostypes;
        if (list) {
            ostypeStore.addFilter((rec) => list.indexOf(rec.data.val) !== -1);
        }
    },

    initComponent: function () {
        var me = this;

        me.items = [
            {
                xtype: 'combobox',
                submitValue: false,
                name: 'osbase',
                reference: 'osbase',
                fieldLabel: gettext('Type'),
                editable: false,
                queryMode: 'local',
                value: 'Linux',
                store: Object.keys(PVE.Utils.kvm_ostypes),
            },
            {
                xtype: 'combobox',
                name: 'ostype',
                reference: 'ostype',
                fieldLabel: gettext('Version'),
                value: 'l26',
                allowBlank: false,
                editable: false,
                queryMode: 'local',
                valueField: 'val',
                displayField: 'desc',
                store: {
                    fields: ['desc', 'val'],
                    data: PVE.Utils.kvm_ostypes.Linux,
                    listeners: {
                        datachanged: function (store) {
                            var ostype = me.lookup('ostype');
                            var old_val = ostype.getValue();
                            if (!me.insideWizard && old_val && store.find('val', old_val) !== -1) {
                                ostype.setValue(old_val);
                            } else {
                                ostype.setValue(store.getAt(0));
                            }
                        },
                    },
                },
            },
        ];

        me.callParent();
    },
});

Ext.define('PVE.qemu.OSTypeEdit', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveQemuOSTypeEdit',

    subject: 'OS Type',

    items: [{ xtype: 'pveQemuOSTypePanel' }],

    initComponent: function () {
        var me = this;

        me.callParent();

        me.load({
            success: function (response, options) {
                var value = response.result.data.ostype || 'other';
                var osinfo = PVE.Utils.get_kvm_osinfo(value);
                me.setValues({ ostype: value, osbase: osinfo.base });
                let arch = PVE.qemu.Architecture.getGuestArchitecture(
                    response.result.data.arch,
                    me.nodename,
                );
                me.down('pveQemuOSTypePanel').setArch(arch);
            },
        });
    },
});
