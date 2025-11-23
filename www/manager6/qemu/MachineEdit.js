Ext.define('PVE.qemu.MachineInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    xtype: 'pveMachineInputPanel',
    onlineHelp: 'qm_machine_type',

    viewModel: {
        data: {
            type: '__default__',
        },
        formulas: {
            q35: (get) => get('type') === 'q35',
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',
        control: {
            'combobox[name=machine]': {
                change: 'onMachineChange',
            },
        },
        onMachineChange: function (field, value) {
            let me = this;
            let version = me.lookup('version');
            let store = version.getStore();
            let oldRec = store.findRecord('id', version.getValue(), 0, false, false, true);
            let type = value === 'q35' ? 'q35' : 'i440fx';
            store.clearFilter();
            store.addFilter((val) => val.data.id === 'latest' || val.data.type === type);
            if (!me.getView().isWindows) {
                version.setValue('latest');
            } else {
                store.isWindows = true;
                if (!oldRec) {
                    return;
                }
                let oldVers = oldRec.data.version;
                // we already filtered by correct type, so just check version property
                let rec = store.findRecord('version', oldVers, 0, false, false, true);
                if (rec) {
                    version.select(rec);
                }
            }
        },
    },

    onGetValues: function (values) {
        if (values.delete === 'machine' && values.viommu) {
            delete values.delete;
            values.machine = 'pc';
        }
        if (values.version && values.version !== 'latest') {
            values.machine = values.version;
            delete values.delete;
        }
        delete values.version;
        if (values.delete === 'machine' && !values.viommu) {
            return values;
        }
        let ret = {};
        ret.machine = PVE.Parser.printPropertyString(values, 'machine');
        return ret;
    },

    setValues: function (values) {
        let me = this;

        let machineConf = PVE.Parser.parsePropertyString(values.machine, 'type');
        values.machine = machineConf.type;

        me.isWindows = values.isWindows;
        if (values.machine === 'pc') {
            values.machine = '__default__';
        }

        if (me.isWindows) {
            if (values.machine === '__default__') {
                values.version = 'pc-i440fx-5.1';
            } else if (values.machine === 'q35') {
                values.version = 'pc-q35-5.1';
            }
        }

        values.viommu = machineConf.viommu || '__default__';

        if (values.machine !== '__default__' && values.machine !== 'q35') {
            values.version = values.machine;
            values.machine = values.version.match(/q35/) ? 'q35' : '__default__';

            // avoid hiding a pinned version
            me.setAdvancedVisible(true);
        }

        this.callParent(arguments);
    },

    items: {
        xtype: 'proxmoxKVComboBox',
        name: 'machine',
        reference: 'machine',
        fieldLabel: gettext('Machine'),
        comboItems: [
            ['__default__', PVE.Utils.render_qemu_machine('')],
            ['q35', 'q35'],
        ],
        bind: {
            value: '{type}',
        },
    },

    advancedItems: [
        {
            xtype: 'combobox',
            name: 'version',
            reference: 'version',
            fieldLabel: gettext('Version'),
            emptyText: gettext('Latest'),
            value: 'latest',
            editable: false,
            valueField: 'id',
            displayField: 'version',
            queryParam: false,
            store: {
                autoLoad: true,
                fields: ['id', 'type', 'version'],
                proxy: {
                    type: 'proxmox',
                    url: '/api2/json/nodes/localhost/capabilities/qemu/machines',
                },
                listeners: {
                    load: function (records) {
                        if (!this.isWindows) {
                            this.insert(0, {
                                id: 'latest',
                                type: 'any',
                                version: gettext('Latest'),
                            });
                        }
                    },
                },
            },
        },
        {
            xtype: 'displayfield',
            fieldLabel: gettext('Note'),
            value: gettext(
                'Machine version change may affect hardware layout and settings in the guest OS.',
            ),
        },
        {
            xtype: 'proxmoxKVComboBox',
            name: 'viommu',
            fieldLabel: gettext('vIOMMU'),
            reference: 'viommu-q35',
            deleteEmpty: false,
            value: '__default__',
            comboItems: [
                ['__default__', Proxmox.Utils.defaultText + ' (None)'],
                ['intel', gettext('Intel (AMD Compatible)')],
                ['virtio', 'VirtIO'],
            ],
            bind: {
                hidden: '{!q35}',
                disabled: '{!q35}',
            },
        },
        {
            xtype: 'proxmoxKVComboBox',
            name: 'viommu',
            fieldLabel: gettext('vIOMMU'),
            reference: 'viommu-i440fx',
            deleteEmpty: false,
            value: '__default__',
            comboItems: [
                ['__default__', Proxmox.Utils.defaultText + ' (None)'],
                ['virtio', 'VirtIO'],
            ],
            bind: {
                hidden: '{q35}',
                disabled: '{q35}',
            },
        },
    ],
});

Ext.define('PVE.qemu.MachineEdit', {
    extend: 'Proxmox.window.Edit',

    subject: gettext('Machine'),

    items: {
        xtype: 'pveMachineInputPanel',
    },

    width: 400,

    initComponent: function () {
        let me = this;

        me.callParent();

        me.load({
            success: function (response) {
                let conf = response.result.data;
                let values = {
                    machine: conf.machine || '__default__',
                };
                values.isWindows = PVE.Utils.is_windows(conf.ostype);
                me.setValues(values);
            },
        });
    },
});
