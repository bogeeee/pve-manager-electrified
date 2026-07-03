Ext.define('PVE.dc.CPUTypeEdit', {
    extend: 'Proxmox.window.Edit',
    alias: ['widget.pveCpuTypeEdit'],
    mixins: ['Proxmox.Mixin.CBind'],

    subject: gettext('CPU Type'),

    // Avoid default-focusing the reported model dropdown while still
    // focusing the name textfield if it is editable
    defaultFocus: 'textfield',

    onlineHelp: '_cpu_type',

    height: 600,
    width: 800,

    cbindData: {
        cputype: '',
        isCreate: (cfg) => !cfg.cputype,
    },

    cbind: {
        autoLoad: (get) => !get('isCreate'),
        url: (get) => `/api2/extjs/cluster/qemu/custom-cpu-models/${get('cputype')}`,
        method: (get) => (get('isCreate') ? 'POST' : 'PUT'),
        isCreate: (get) => get('isCreate'),
    },

    items: [
        {
            xtype: 'inputpanel',
            onGetValues: function (values) {
                let win = this.up('window');

                PVE.Utils.delete_if_default(values, 'reported-model', '', win.isCreate);
                PVE.Utils.delete_if_default(values, 'hv-vendor-id', '', win.isCreate);
                PVE.Utils.delete_if_default(values, 'phys-bits', '', win.isCreate);
                PVE.Utils.delete_if_default(values, 'hidden', 0, win.isCreate);
                PVE.Utils.delete_if_default(values, 'flags', '', win.isCreate);

                if (win.isCreate) {
                    delete values.delete;
                }

                return values;
            },
            column1: [
                {
                    xtype: 'pmxDisplayEditField',
                    fieldLabel: gettext('Name'),
                    cbind: {
                        editable: '{isCreate}',
                        value: '{cputype}',
                    },
                    vtype: 'ConfigId',
                    name: 'cputype',
                    maxLength: 40,
                    renderer: (val) => val.replace(/^custom-/, ''),
                    allowBlank: false,
                },
                {
                    xtype: 'CPUModelSelector',
                    fieldLabel: gettext('Base Model'),
                    showCustomModels: false,
                    showAbstractModels: false,
                    name: 'reported-model',
                    autoEl: {
                        tag: 'div',
                        'data-qtip': gettext(
                            'CPU model the rest of the configuration is based on.',
                        ),
                    },
                    cbind: {
                        allowBlank: (get) => !get('isCreate'),
                    },
                    listeners: {
                        afterrender: function (field) {
                            let win = field.up('window');
                            if (win.isCreate) {
                                field.setEmptyText('');
                            }
                        },
                    },
                },
                {
                    xtype: 'textfield',
                    fieldLabel: gettext('Hyper-V Vendor'),
                    name: 'hv-vendor-id',
                    allowBlank: true,
                    emptyText: gettext('None'),
                    maxLength: 12,
                },
            ],
            column2: [
                {
                    xtype: 'checkbox',
                    fieldLabel: gettext('Hide Hypervisor'),
                    autoEl: {
                        tag: 'div',
                        'data-qtip': gettext(
                            'Hide the KVM hypervisor signature in the guest CPUID,' +
                                ' for guests that misbehave when detecting that they run' +
                                ' under KVM such as older NVIDIA GPU drivers.',
                        ),
                    },
                    name: 'hidden',
                    inputValue: 1,
                    uncheckedValue: 0,
                },
                {
                    xtype: 'PhysBitsSelector',
                    fieldLabel: gettext('Physical Address Bits'),
                    autoEl: {
                        tag: 'div',
                        'data-qtip': gettext(
                            'Live migration fails to hosts whose CPU supports fewer bits than' +
                                ' the configured value.',
                        ),
                    },
                    name: 'phys-bits',
                },
            ],
            columnB: [
                {
                    xtype: 'vmcpuflagselector',
                    fieldLabel: gettext('Extra CPU flags'),
                    name: 'flags',
                    reference: 'cpuFlags',
                    restrictToVMFlags: false,
                    height: 380,
                },
            ],
        },
    ],
});
