// The view model of the parent should contain a 'cgroupMode' variable (or params for v2 are used).
Ext.define('PVE.qemu.ProcessorInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    alias: 'widget.pveQemuProcessorPanel',
    onlineHelp: 'qm_cpu',

    insideWizard: false,

    viewModel: {
        data: {
            socketCount: 1,
            coreCount: 1,
            showCustomModelPermWarning: false,
            userIsRoot: false,
        },
        formulas: {
            totalCoreCount: (get) => get('socketCount') * get('coreCount'),
            cpuunitsDefault: (get) => (get('cgroupMode') === 1 ? 1024 : 100),
            cpuunitsMin: (get) => (get('cgroupMode') === 1 ? 2 : 1),
            cpuunitsMax: (get) => (get('cgroupMode') === 1 ? 262144 : 10000),
        },
    },

    controller: {
        xclass: 'Ext.app.ViewController',
        init: function () {
            let me = this;
            let viewModel = me.getViewModel();

            viewModel.set('userIsRoot', Proxmox.UserName === 'root@pam');
        },
    },

    onGetValues: function (values) {
        let me = this;
        let cpuunitsDefault = me.getViewModel().get('cpuunitsDefault');

        if (Array.isArray(values.delete)) {
            values.delete = values.delete.join(',');
        }

        PVE.Utils.delete_if_default(values, 'cpulimit', '0', me.insideWizard);
        PVE.Utils.delete_if_default(values, 'cpuunits', `${cpuunitsDefault}`, me.insideWizard);

        // build the cpu options:
        me.cpu.cputype = values.cputype;

        if (values.flags) {
            me.cpu.flags = values.flags;
        } else {
            delete me.cpu.flags;
        }

        delete values.cputype;
        delete values.flags;
        var cpustring = PVE.Parser.printQemuCpu(me.cpu);

        // remove cputype delete request:
        var del = values.delete;
        delete values.delete;
        if (del) {
            del = del.split(',');
            Ext.Array.remove(del, 'cputype');
        } else {
            del = [];
        }

        if (cpustring) {
            values.cpu = cpustring;
        } else {
            del.push('cpu');
        }

        var delarr = del.join(',');
        if (delarr) {
            values.delete = delarr;
        }

        return values;
    },

    setValues: function (values) {
        let me = this;

        let type = values.cputype;
        let typeSelector = me.lookupReference('cputype');
        let typeStore = typeSelector.getStore();
        typeStore.on('load', (store, records, success) => {
            if (!success || !type || records.some((x) => x.data.name === type)) {
                return;
            }

            // if we get here, a custom CPU model is selected for the VM but we
            // don't have permission to configure it - it will not be in the
            // list retrieved from the API, so add it manually to allow changing
            // other processor options
            typeStore.add({
                name: type,
                displayname: type.replace(/^custom-/, ''),
                custom: 1,
                vendor: gettext('Unknown'),
            });
            typeSelector.select(type);
        });

        me.callParent([values]);
    },

    cpu: {},

    column1: [
        {
            xtype: 'proxmoxintegerfield',
            name: 'sockets',
            minValue: 1,
            maxValue: 4,
            value: '1',
            fieldLabel: gettext('Sockets'),
            allowBlank: false,
            bind: {
                value: '{socketCount}',
            },
        },
        {
            xtype: 'proxmoxintegerfield',
            name: 'cores',
            minValue: 1,
            maxValue: 256,
            value: '1',
            fieldLabel: gettext('Cores'),
            allowBlank: false,
            bind: {
                value: '{coreCount}',
            },
        },
    ],

    column2: [
        {
            xtype: 'CPUModelSelector',
            name: 'cputype',
            reference: 'cputype',
            fieldLabel: gettext('Type'),
        },
        {
            xtype: 'displayfield',
            fieldLabel: gettext('Total cores'),
            name: 'totalcores',
            isFormField: false,
            bind: {
                value: '{totalCoreCount}',
            },
        },
    ],

    columnB: [
        {
            xtype: 'displayfield',
            userCls: 'pmx-hint',
            value: gettext(
                'WARNING: You do not have permission to configure custom CPU types, if you change the type you will not be able to go back!',
            ),
            hidden: true,
            bind: {
                hidden: '{!showCustomModelPermWarning}',
            },
        },
    ],

    advancedColumn1: [
        {
            xtype: 'proxmoxintegerfield',
            name: 'vcpus',
            minValue: 1,
            maxValue: 1,
            value: '',
            fieldLabel: gettext('VCPUs'),
            deleteEmpty: true,
            allowBlank: true,
            emptyText: '1',
            bind: {
                emptyText: '{totalCoreCount}',
                maxValue: '{totalCoreCount}',
            },
        },
        {
            xtype: 'numberfield',
            name: 'cpulimit',
            minValue: 0,
            maxValue: 128, // api maximum
            value: '',
            step: 1,
            fieldLabel: gettext('CPU limit'),
            allowBlank: true,
            emptyText: gettext('unlimited'),
        },
        {
            xtype: 'proxmoxtextfield',
            name: 'affinity',
            vtype: 'CpuSet',
            value: '',
            fieldLabel: gettext('CPU Affinity'),
            allowBlank: true,
            emptyText: gettext('All Cores'),
            deleteEmpty: true,
            bind: {
                disabled: '{!userIsRoot}',
            },
        },
    ],

    advancedColumn2: [
        {
            xtype: 'proxmoxintegerfield',
            name: 'cpuunits',
            fieldLabel: gettext('CPU units'),
            minValue: '1',
            maxValue: '10000',
            value: '',
            emptyText: '100',
            bind: {
                minValue: '{cpuunitsMin}',
                maxValue: '{cpuunitsMax}',
                emptyText: '{cpuunitsDefault}',
            },
            deleteEmpty: true,
            allowBlank: true,
        },
        {
            xtype: 'proxmoxcheckbox',
            fieldLabel: gettext('Enable NUMA'),
            name: 'numa',
            uncheckedValue: 0,
        },
    ],
    advancedColumnB: [
        {
            xtype: 'label',
            text: 'Extra CPU Flags:',
        },
        {
            xtype: 'vmcpuflagselector',
            name: 'flags',
        },
    ],
});

Ext.define('PVE.qemu.ProcessorEdit', {
    extend: 'Proxmox.window.Edit',
    alias: 'widget.pveQemuProcessorEdit',

    width: 700,

    viewModel: {
        data: {
            cgroupMode: 2,
        },
    },

    initComponent: function () {
        let me = this;
        me.getViewModel().set('cgroupMode', me.cgroupMode);

        var ipanel = Ext.create('PVE.qemu.ProcessorInputPanel');

        Ext.apply(me, {
            subject: gettext('Processors'),
            items: ipanel,
        });

        me.callParent();

        me.load({
            success: function (response, options) {
                var data = response.result.data;
                var value = data.cpu;
                if (value) {
                    let cpu = PVE.Parser.parseQemuCpu(value);
                    ipanel.cpu = cpu;
                    data.cputype = cpu.cputype;
                    if (cpu.flags) {
                        data.flags = cpu.flags;
                    }

                    let caps = Ext.state.Manager.get('GuiCap');
                    if (data.cputype.indexOf('custom-') === 0 && !caps.nodes['Sys.Audit']) {
                        let vm = ipanel.getViewModel();
                        vm.set('showCustomModelPermWarning', true);
                    }
                }
                me.setValues(data);
            },
        });
    },
});
