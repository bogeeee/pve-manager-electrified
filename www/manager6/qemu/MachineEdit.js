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

            me.setVersionFilter(value);

            if (!me.getView().isWindows) {
                version.setValue('latest');
            } else {
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

        setVersionFilter: function (machineType) {
            let me = this;
            let vm = me.getViewModel();
            let arch = vm.get('arch');
            let defaultMachine = PVE.qemu.Architecture.defaultMachines[arch];
            if (defaultMachine === 'pc') {
                defaultMachine = 'i440fx'; // the default in the backend is 'pc' which means 'i440fx' for the qemu machinetype
            }
            let type = machineType === 'q35' ? 'q35' : defaultMachine;
            let store = me.lookup('version').getStore();
            store.clearFilter();
            store.addFilter((val) => val.data.id === 'latest' || val.data.type === type);
            store.isWindows = me.getView().isWindows;
        },

        setArch: function (arch) {
            let me = this;
            let store = me.lookup('version').getStore();
            store.getProxy().setExtraParams({
                arch,
            });
            store.reload();
        },
    },

    onGetValues: function (values) {
        // arch is a hidden field used only for the machine-default lookup; do not submit it.
        let arch = values.arch;
        delete values.arch;
        if (values.delete === 'machine' && values.viommu) {
            delete values.delete;
            values.machine = PVE.qemu.Architecture.defaultMachines[arch];
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

        let defaultMachine = PVE.qemu.Architecture.defaultMachines[values.arch];
        me.isWindows = values.isWindows;
        if (values.machine === defaultMachine) {
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
        this.getController().setVersionFilter(values.machine);
        this.getController().setArch(values.arch);
    },

    items: [
        {
            xtype: 'pveQemuMachineSelector',
            name: 'machine',
            reference: 'machine',
            fieldLabel: gettext('Machine'),
            value: '__default__',
            bind: {
                value: '{type}',
                category: '{arch}',
            },
        },
        {
            xtype: 'hidden',
            name: 'arch',
            reference: 'arch',
            bind: '{arch}',
        },
    ],

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

        me.nodename = me.pveSelNode?.data.node;

        if (!me.nodename) {
            throw 'no nodename given';
        }

        me.callParent();

        me.load({
            success: function (response) {
                let conf = response.result.data;
                let values = {
                    machine: conf.machine || '__default__',
                };
                values.isWindows = PVE.Utils.is_windows(conf.ostype);
                values.arch = PVE.qemu.Architecture.getGuestArchitecture(conf.arch, me.nodename);
                me.setValues(values);
            },
        });
    },
});
