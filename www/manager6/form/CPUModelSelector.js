Ext.define('PVE.data.CPUModel', {
    extend: 'Ext.data.Model',
    fields: [
        { name: 'name' },
        { name: 'vendor' },
        { name: 'custom' },
        { name: 'abstract' },
        { name: 'displayname' },
    ],
});

Ext.define('PVE.form.CPUModelSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: ['widget.CPUModelSelector'],

    valueField: 'name',
    displayField: 'displayname',

    emptyText: Proxmox.Utils.defaultText + ' (kvm64)',
    allowBlank: true,

    editable: true,
    anyMatch: true,
    forceSelection: true,
    autoSelect: false,
    triggerAction: 'query',

    deleteEmpty: true,
    config: {
        showCustomModels: true,
        // PVE-internal abstract profiles (x86-64-vN) resolve to qemu64 + flag set
        // at VM start and are not valid as a custom CPU model's reported-model.
        showAbstractModels: true,
    },

    getSubmitData: function () {
        let me = this,
            data = null,
            val;
        if (!me.disabled && me.submitValue) {
            val = me.getSubmitValue();
            if (val !== null && val !== '' && val !== undefined) {
                data = {};
                data[me.getName()] = val;
            } else if (me.getDeleteEmpty()) {
                data = {};
                // special case to change gui default for x86
                if (me.arch === 'x86_64') {
                    data[me.getName()] = PVE.qemu.Architecture.defaultProcessorModel.x86_64;
                } else {
                    data.delete = me.getName();
                }
            }
        }
        return data;
    },

    listConfig: {
        columns: [
            {
                header: gettext('Model'),
                dataIndex: 'displayname',
                hideable: false,
                sortable: true,
                flex: 3,
            },
            {
                header: gettext('Vendor'),
                dataIndex: 'vendor',
                hideable: false,
                sortable: true,
                flex: 2,
            },
        ],
        width: 360,
    },

    arch: undefined,

    setArch: function (arch) {
        let me = this;
        me.arch = arch;
        let params = {};
        if (arch) {
            params.arch = arch;
        }
        me.store.getProxy().setExtraParams(params);
        me.store.reload();

        let defaultCPU = PVE.qemu.Architecture.defaultProcessorModel[arch] ?? 'kvm64';

        me.setEmptyText(`${Proxmox.Utils.defaultText} (${defaultCPU})`);
    },

    store: {
        autoLoad: true,
        model: 'PVE.data.CPUModel',
        proxy: {
            type: 'proxmox',
            url: '/api2/json/nodes/localhost/capabilities/qemu/cpu',
        },
        sorters: [
            {
                sorterFn: function (recordA, recordB) {
                    let a = recordA.data;
                    let b = recordB.data;

                    let vendorOrder = PVE.Utils.cpu_vendor_order;
                    let orderA = vendorOrder[a.vendor] || vendorOrder._default_;
                    let orderB = vendorOrder[b.vendor] || vendorOrder._default_;

                    if (orderA > orderB) {
                        return 1;
                    } else if (orderA < orderB) {
                        return -1;
                    }

                    // Within same vendor, sort alphabetically
                    return a.name.localeCompare(b.name);
                },
                direction: 'ASC',
            },
        ],
        listeners: {
            load: function (store, records, success) {
                if (success) {
                    records.forEach((rec) => {
                        rec.data.displayname = rec.data.name.replace(/^custom-/, '');

                        let vendor = rec.data.vendor;

                        if (rec.data.name === 'host') {
                            vendor = 'Host';
                        }

                        // We receive vendor names as given to QEMU as CPUID
                        vendor = PVE.Utils.cpu_vendor_map[vendor] || vendor;

                        if (rec.data.custom) {
                            vendor = gettext('Custom') + ` (${vendor})`;
                        }

                        rec.data.vendor = vendor;
                    });

                    store.sort();
                }
            },
        },
    },
    initComponent: function () {
        let me = this;
        me.callParent();
        if (!me.showCustomModels) {
            me.getStore().addFilter({ filterFn: (rec) => !rec.data.custom });
        }
        if (!me.showAbstractModels) {
            me.getStore().addFilter({ filterFn: (rec) => !rec.data.abstract });
        }
    },
});
